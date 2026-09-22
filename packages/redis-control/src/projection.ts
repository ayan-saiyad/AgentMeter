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
    if (await control.hasBudget(period.tenantId, period.id)) continue;
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
        select: { reservedMicrodollars: true },
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
  }
}
