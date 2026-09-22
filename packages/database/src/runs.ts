import {
  Prisma,
  type PrismaClient,
  type SettlementEvidence,
} from "@prisma/client";

export interface ReservedRunInput {
  applicationId: string;
  budgetPeriodId: string;
  id: string;
  idempotencyDigest: string;
  maxDurationMs: number;
  maxOutputTokens: number;
  model: string;
  modelPriceId?: string;
  policySnapshot: Prisma.InputJsonValue;
  policyVersionId?: string;
  priceSnapshot: Prisma.InputJsonValue;
  provider: string;
  requestMetadata?: Prisma.InputJsonValue;
  reservedMicrodollars: bigint;
  tenantId: string;
}

export async function createReservedRun(
  database: PrismaClient,
  input: ReservedRunInput,
) {
  return database.agentRun.create({
    data: {
      id: input.id,
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      budgetPeriodId: input.budgetPeriodId,
      idempotencyDigest: input.idempotencyDigest,
      maxDurationMs: input.maxDurationMs,
      maxOutputTokens: input.maxOutputTokens,
      model: input.model,
      ...(input.modelPriceId ? { modelPriceId: input.modelPriceId } : {}),
      policySnapshot: input.policySnapshot,
      ...(input.policyVersionId
        ? { policyVersionId: input.policyVersionId }
        : {}),
      priceSnapshot: input.priceSnapshot,
      provider: input.provider,
      ...(input.requestMetadata
        ? { requestMetadata: input.requestMetadata }
        : {}),
      reservedMicrodollars: input.reservedMicrodollars,
      status: "RESERVED",
    },
  });
}

export async function claimRun(
  database: PrismaClient,
  runId: string,
  owner: string,
): Promise<boolean> {
  const result = await database.agentRun.updateMany({
    where: { id: runId, executionOwner: null, status: "RESERVED" },
    data: {
      executionClaimedAt: new Date(),
      executionOwner: owner,
      providerStartedAt: new Date(),
      status: "RUNNING",
    },
  });
  return result.count === 1;
}

export interface FinalUsage {
  actualMicrodollars: bigint;
  cachedTokens?: number;
  evidence: SettlementEvidence;
  evidencePayload?: Prisma.InputJsonValue;
  inputTokens: number;
  outputTokens: number;
  sequence: number;
  toolCalls: number;
}

export async function finalizeRun(
  database: PrismaClient,
  runId: string,
  usage: FinalUsage,
) {
  return database.$transaction(
    async (transaction) => {
      const existing = await transaction.settlement.findUnique({
        where: { runId },
      });
      if (existing) {
        return existing;
      }

      const run = await transaction.agentRun.findUniqueOrThrow({
        where: { id: runId },
      });
      if (
        !["RUNNING", "ABORTED", "FAILED", "RECONCILING"].includes(run.status)
      ) {
        throw new Error(`Run ${runId} cannot be settled from ${run.status}`);
      }

      await transaction.usageEvent.create({
        data: {
          tenantId: run.tenantId,
          runId: run.id,
          sequence: usage.sequence,
          type:
            usage.evidence === "PROVIDER_FINAL"
              ? "PROVIDER_FINAL"
              : "RECONCILIATION",
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedTokens: usage.cachedTokens ?? 0,
          toolCalls: usage.toolCalls,
          costMicrodollars: usage.actualMicrodollars,
          ...(usage.evidencePayload ? { evidence: usage.evidencePayload } : {}),
        },
      });

      const unused =
        run.reservedMicrodollars > usage.actualMicrodollars
          ? run.reservedMicrodollars - usage.actualMicrodollars
          : 0n;
      const settlement = await transaction.settlement.create({
        data: {
          tenantId: run.tenantId,
          runId: run.id,
          reservedMicrodollars: run.reservedMicrodollars,
          actualMicrodollars: usage.actualMicrodollars,
          unusedMicrodollars: unused,
          evidence: usage.evidence,
        },
      });

      await transaction.agentRun.update({
        where: { id: run.id },
        data: {
          actualMicrodollars: usage.actualMicrodollars,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          toolCalls: usage.toolCalls,
          settledAt: new Date(),
          status: "SETTLED",
        },
      });

      await transaction.outboxEvent.create({
        data: {
          tenantId: run.tenantId,
          aggregateType: "run",
          aggregateId: run.id,
          eventType: "run.settled",
          dedupeKey: settlement.id,
          payload: {
            actualMicrodollars: usage.actualMicrodollars.toString(),
            budgetPeriodId: run.budgetPeriodId,
            reservedMicrodollars: run.reservedMicrodollars.toString(),
            runId: run.id,
            settlementId: settlement.id,
            tenantId: run.tenantId,
          },
        },
      });

      return settlement;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
