import { policyRulesSchema } from "@agentmeter/contracts";
import type { PrismaClient } from "@agentmeter/database";
import type { RedisControl } from "./index.js";

const activeStatuses = [
  "RESERVED",
  "RUNNING",
  "ABORTED",
  "FAILED",
  "EXPIRED",
  "RECONCILING",
] as const;

export async function initializeCurrentBudgets(
  database: PrismaClient,
  control: RedisControl,
  options: { force?: boolean; leaseTtlMs?: number } = {},
): Promise<void> {
  const now = new Date();
  const periods = await database.budgetPeriod.findMany({
    where: {
      startsAt: { lte: now },
      endsAt: { gt: now },
      budget: { status: "ACTIVE" },
    },
    include: { budget: true },
  });

  for (const period of periods) {
    if (!options.force && (await control.hasBudget(period.tenantId, period.id)))
      continue;
    const targets = period.budget.applicationId
      ? [
          { targetType: "TENANT", targetId: null },
          {
            targetType: "APPLICATION",
            targetId: period.budget.applicationId,
          },
        ]
      : [{ targetType: "TENANT", targetId: null }];
    const [settled, active, binding] = await Promise.all([
      database.settlement.aggregate({
        where: { run: { budgetPeriodId: period.id } },
        _sum: { actualMicrodollars: true },
      }),
      database.agentRun.findMany({
        where: {
          budgetPeriodId: period.id,
          status: { in: [...activeStatuses] },
        },
        select: {
          executionOwner: true,
          id: true,
          idempotencyDigest: true,
          reservedMicrodollars: true,
          status: true,
        },
      }),
      database.policyBinding.findFirst({
        where: {
          tenantId: period.tenantId,
          enabled: true,
          OR: targets,
        },
        orderBy: { priority: "desc" },
        include: { policyVersion: true },
      }),
    ]);
    const concurrency = binding
      ? policyRulesSchema.parse(binding.policyVersion.rules).maxConcurrency
      : 1;
    await control.initializeBudget({
      active: active.length,
      budgetPeriodId: period.id,
      concurrency,
      generation: 1,
      limitMicrodollars: period.limitMicrodollars,
      reservedMicrodollars: active.reduce(
        (total, run) => total + run.reservedMicrodollars,
        0n,
      ),
      spentMicrodollars: settled._sum.actualMicrodollars ?? 0n,
      tenantId: period.tenantId,
    });
    const leaseExpiresAt = Date.now() + (options.leaseTtlMs ?? 90_000);
    for (const run of active) {
      await control.restoreRun({
        amountMicrodollars: run.reservedMicrodollars,
        budgetPeriodId: period.id,
        expiresAt: leaseExpiresAt,
        idempotencyDigest: run.idempotencyDigest,
        idempotencyTtlMs: 24 * 60 * 60 * 1_000,
        ...(run.executionOwner ? { owner: run.executionOwner } : {}),
        runId: run.id,
        status: ["RESERVED", "RUNNING"].includes(run.status)
          ? run.status
          : "RECONCILING",
        tenantId: period.tenantId,
      });
    }
  }
}
