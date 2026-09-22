import { modelPriceSchema } from "@agentmeter/contracts";
import { finalizeRun, type PrismaClient } from "@agentmeter/database";
import { computeActualCost } from "@agentmeter/policy";
import type { ProviderAdapter } from "@agentmeter/providers";
import type { RedisControl } from "@agentmeter/redis-control";

async function openReconciliation(
  database: PrismaClient,
  tenantId: string,
  runId: string,
  reason: string,
  deadlineMs: number,
): Promise<void> {
  await database.$transaction(async (transaction) => {
    await transaction.agentRun.updateMany({
      where: { id: runId, status: { notIn: ["SETTLED", "CANCELLED"] } },
      data: { failureCode: reason, status: "RECONCILING" },
    });
    await transaction.reconciliationCase.upsert({
      where: { runId },
      update: { reason, status: "OPEN" },
      create: {
        tenantId,
        runId,
        reason,
        deadlineAt: new Date(Date.now() + deadlineMs),
      },
    });
  });
}

export async function sweepExpiredLeases(
  database: PrismaClient,
  redis: RedisControl,
  deadlineMs: number,
): Promise<number> {
  const tenants = await database.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  let recovered = 0;
  for (const tenant of tenants) {
    const runIds = await redis.dueLeases(tenant.id);
    for (const runId of runIds) {
      const [state, run] = await Promise.all([
        redis.runState(tenant.id, runId),
        database.agentRun.findFirst({
          where: { id: runId, tenantId: tenant.id },
          include: { settlement: true },
        }),
      ]);
      const budgetPeriodId = run?.budgetPeriodId ?? state.budget_period_id;
      if (!budgetPeriodId) continue;
      if (!run) {
        const result = await redis.cancel(
          tenant.id,
          budgetPeriodId,
          runId,
          "DURABLE_RUN_MISSING",
        );
        if (["CANCELLED", "ALREADY_CANCELLED"].includes(result[0] ?? ""))
          recovered += 1;
        continue;
      }
      if (run.settlement) {
        const result = await redis.settle({
          actualMicrodollars: run.settlement.actualMicrodollars,
          budgetPeriodId,
          runId,
          settlementId: run.settlement.id,
          tenantId: tenant.id,
        });
        if (["SETTLED", "ALREADY_APPLIED"].includes(result[0] ?? ""))
          recovered += 1;
        continue;
      }
      if (run.status === "RESERVED" && !run.providerStartedAt) {
        const result = await redis.cancel(
          tenant.id,
          budgetPeriodId,
          runId,
          "RESERVATION_EXPIRED",
        );
        if (["CANCELLED", "ALREADY_CANCELLED"].includes(result[0] ?? "")) {
          await database.agentRun.update({
            where: { id: run.id },
            data: { failureCode: "RESERVATION_EXPIRED", status: "EXPIRED" },
          });
          recovered += 1;
        }
        continue;
      }
      await openReconciliation(
        database,
        tenant.id,
        run.id,
        "LEASE_EXPIRED_AFTER_START",
        deadlineMs,
      );
      await redis.hold(tenant.id, run.id, "LEASE_EXPIRED_AFTER_START");
      recovered += 1;
    }
  }
  return recovered;
}

async function settleReconciliation(
  database: PrismaClient,
  caseId: string,
  runId: string,
  usage: {
    actualMicrodollars: bigint;
    cachedTokens: number;
    evidence: "PROVIDER_FINAL" | "RECONCILED" | "CONSERVATIVE_ESTIMATE";
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
  },
): Promise<void> {
  const aggregate = await database.usageEvent.aggregate({
    where: { runId },
    _max: { sequence: true },
  });
  const settlement = await finalizeRun(database, runId, {
    ...usage,
    evidencePayload: { source: "reconciliation-worker" },
    sequence: (aggregate._max.sequence ?? 0) + 1,
  });
  await database.reconciliationCase.update({
    where: { id: caseId },
    data: {
      resolution: {
        actualMicrodollars: settlement.actualMicrodollars.toString(),
        evidence: usage.evidence,
      },
      resolvedAt: new Date(),
      status: "RESOLVED",
    },
  });
}

export async function reconcileCases(
  database: PrismaClient,
  provider: ProviderAdapter,
  limit = 25,
): Promise<number> {
  const cases = await database.reconciliationCase.findMany({
    where: {
      status: { in: ["OPEN", "RETRYING"] },
      nextAttemptAt: { lte: new Date() },
    },
    include: { run: { include: { settlement: true } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const item of cases) {
    try {
      if (item.run.settlement) {
        await database.reconciliationCase.update({
          where: { id: item.id },
          data: {
            resolution: { evidence: item.run.settlement.evidence },
            resolvedAt: new Date(),
            status: "RESOLVED",
          },
        });
        continue;
      }
      const providerUsage =
        item.run.providerRequestId && provider.getUsage
          ? await provider.getUsage(item.run.providerRequestId)
          : null;
      if (providerUsage) {
        const snapshot = item.run.priceSnapshot as Record<string, unknown>;
        const price = modelPriceSchema.parse({
          ...snapshot,
          cachedPerMillionMicrodollars: String(
            snapshot["cachedPerMillionMicrodollars"],
          ),
          inputPerMillionMicrodollars: String(
            snapshot["inputPerMillionMicrodollars"],
          ),
          outputPerMillionMicrodollars: String(
            snapshot["outputPerMillionMicrodollars"],
          ),
          toolCallMicrodollars: String(snapshot["toolCallMicrodollars"]),
        });
        await settleReconciliation(database, item.id, item.run.id, {
          actualMicrodollars: computeActualCost({ ...providerUsage, price }),
          ...providerUsage,
          evidence: "RECONCILED",
        });
      } else if (item.deadlineAt <= new Date()) {
        await settleReconciliation(database, item.id, item.run.id, {
          actualMicrodollars: item.run.reservedMicrodollars,
          cachedTokens: 0,
          evidence: "CONSERVATIVE_ESTIMATE",
          inputTokens: item.run.inputTokens,
          outputTokens: item.run.outputTokens,
          toolCalls: item.run.toolCalls,
        });
      } else {
        const attempts = item.attempts + 1;
        await database.reconciliationCase.update({
          where: { id: item.id },
          data: {
            attempts,
            lastError: "Provider usage is not available yet",
            nextAttemptAt: new Date(
              Date.now() + Math.min(60_000, 2 ** attempts * 500),
            ),
            status: "RETRYING",
          },
        });
      }
    } catch (error) {
      const attempts = item.attempts + 1;
      await database.reconciliationCase.update({
        where: { id: item.id },
        data: {
          attempts,
          lastError: error instanceof Error ? error.message : "Unknown error",
          nextAttemptAt: new Date(
            Date.now() + Math.min(60_000, 2 ** attempts * 500),
          ),
          status: attempts >= 10 ? "MANUAL_REVIEW" : "RETRYING",
        },
      });
    }
  }
  return cases.length;
}
