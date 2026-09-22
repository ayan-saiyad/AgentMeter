import { randomUUID } from "node:crypto";
import { database } from "@agentmeter/database";
import {
  createRedisControl,
  initializeCurrentBudgets,
  loadFunctionLibrary,
  type RedisControl,
} from "@agentmeter/redis-control";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepExpiredLeases } from "../apps/worker/src/recovery.js";

const enabled = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const integration = enabled ? describe : describe.skip;

integration("lease recovery", () => {
  let redis: RedisControl;
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const budgetPeriodId = "00000000-0000-4000-8000-000000000004";

  beforeAll(async () => {
    redis = await createRedisControl(process.env.REDIS_URL!);
    await loadFunctionLibrary(redis.client);
    await initializeCurrentBudgets(database, redis, { force: true });
  });

  afterAll(async () => {
    await Promise.all([database.$disconnect(), redis.client.quit()]);
  });

  it("releases a reservation with no durable run", async () => {
    const runId = randomUUID();
    const before = await redis.budgetState(tenantId, budgetPeriodId);
    await redis.reserve({
      amountMicrodollars: 100n,
      budgetPeriodId,
      idempotencyDigest: `orphan-${runId}`,
      idempotencyTtlMs: 60_000,
      leaseTtlMs: 5,
      owner: "terminated-gateway",
      runId,
      tenantId,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await sweepExpiredLeases(database, redis, 60_000);
    const after = await redis.budgetState(tenantId, budgetPeriodId);
    expect(after.reservedMicrodollars).toBe(before.reservedMicrodollars);
    expect((await redis.runState(tenantId, runId)).status).toBe("CANCELLED");
  });
});
