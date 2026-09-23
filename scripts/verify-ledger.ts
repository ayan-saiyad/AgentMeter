import { parseConfig, workerConfigSchema } from "@agentmeter/config";
import { database } from "@agentmeter/database";
import { createRedisControl } from "@agentmeter/redis-control";

const config = parseConfig(workerConfigSchema);
const redis = await createRedisControl(config.REDIS_URL);
const activeStatuses = [
  "RESERVED",
  "RUNNING",
  "ABORTED",
  "FAILED",
  "EXPIRED",
  "RECONCILING",
] as const;
let failures = 0;

try {
  const now = new Date();
  const periods = await database.budgetPeriod.findMany({
    where: { startsAt: { lte: now }, endsAt: { gt: now } },
  });
  for (const period of periods) {
    const [state, settled, active] = await Promise.all([
      redis.budgetState(period.tenantId, period.id),
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
    ]);
    const expectedSpent = settled._sum.actualMicrodollars ?? 0n;
    const expectedReserved = active.reduce(
      (total, run) => total + run.reservedMicrodollars,
      0n,
    );
    const valid =
      state.spentMicrodollars === expectedSpent &&
      state.reservedMicrodollars === expectedReserved &&
      state.active === active.length &&
      state.spentMicrodollars + state.reservedMicrodollars <=
        state.limitMicrodollars + state.overageMicrodollars;
    if (!valid) failures += 1;
    console.log(
      JSON.stringify({
        active: { durable: active.length, redis: state.active },
        budgetPeriodId: period.id,
        reserved: {
          durable: expectedReserved.toString(),
          redis: state.reservedMicrodollars.toString(),
        },
        spent: {
          durable: expectedSpent.toString(),
          redis: state.spentMicrodollars.toString(),
        },
        valid,
      }),
    );
  }
} finally {
  await Promise.all([database.$disconnect(), redis.client.quit()]);
}

if (failures > 0) process.exitCode = 1;
