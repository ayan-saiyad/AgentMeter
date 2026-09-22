import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRedisControl,
  loadFunctionLibrary,
  type RedisControl,
} from "@agentmeter/redis-control";

const enabled = Boolean(process.env.REDIS_URL);
const integration = enabled ? describe : describe.skip;

integration("atomic admission", () => {
  let control: RedisControl;
  const tenantId = `test-${randomUUID()}`;
  const budgetPeriodId = randomUUID();

  beforeAll(async () => {
    control = await createRedisControl(process.env.REDIS_URL!);
    await loadFunctionLibrary(control.client);
    await control.initializeBudget({
      budgetPeriodId,
      concurrency: 20,
      limitMicrodollars: 10_000_000n,
      tenantId,
    });
  });

  afterAll(async () => control.client.quit());

  it("never overcommits concurrent reservations", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const runId = randomUUID();
        return control.reserve({
          amountMicrodollars: 1_000_000n,
          budgetPeriodId,
          idempotencyDigest: `request-${index}`,
          idempotencyTtlMs: 60_000,
          leaseTtlMs: 60_000,
          owner: "test-owner",
          runId,
          tenantId,
        });
      }),
    );

    expect(
      results.filter((result) => result.decision === "ACCEPTED"),
    ).toHaveLength(10);
    expect(
      results.filter((result) => result.reason === "BUDGET_EXHAUSTED"),
    ).toHaveLength(10);
    const state = await control.budgetState(tenantId, budgetPeriodId);
    expect(state.reservedMicrodollars).toBe(10_000_000n);
    expect(
      state.spentMicrodollars + state.reservedMicrodollars,
    ).toBeLessThanOrEqual(state.limitMicrodollars);
  });

  it("returns one result for concurrent duplicates", async () => {
    const duplicateTenant = `test-${randomUUID()}`;
    const duplicatePeriod = randomUUID();
    const runId = randomUUID();
    await control.initializeBudget({
      budgetPeriodId: duplicatePeriod,
      concurrency: 20,
      limitMicrodollars: 10_000_000n,
      tenantId: duplicateTenant,
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, async () =>
        control.reserve({
          amountMicrodollars: 1_000_000n,
          budgetPeriodId: duplicatePeriod,
          idempotencyDigest: "same-request",
          idempotencyTtlMs: 60_000,
          leaseTtlMs: 60_000,
          owner: "test-owner",
          runId,
          tenantId: duplicateTenant,
        }),
      ),
    );

    expect(new Set(results.map((result) => result.runId))).toEqual(
      new Set([runId]),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(
      (await control.budgetState(duplicateTenant, duplicatePeriod))
        .reservedMicrodollars,
    ).toBe(1_000_000n);
  });

  it("settles and cancels idempotently", async () => {
    const lifecycleTenant = `test-${randomUUID()}`;
    const lifecyclePeriod = randomUUID();
    const settledRun = randomUUID();
    const cancelledRun = randomUUID();
    await control.initializeBudget({
      budgetPeriodId: lifecyclePeriod,
      concurrency: 2,
      limitMicrodollars: 2_000_000n,
      tenantId: lifecycleTenant,
    });

    for (const [runId, digest] of [
      [settledRun, "settled"],
      [cancelledRun, "cancelled"],
    ] as const) {
      await control.reserve({
        amountMicrodollars: 1_000_000n,
        budgetPeriodId: lifecyclePeriod,
        idempotencyDigest: digest,
        idempotencyTtlMs: 60_000,
        leaseTtlMs: 60_000,
        owner: "owner",
        runId,
        tenantId: lifecycleTenant,
      });
    }

    expect(
      await control.markRunning(lifecycleTenant, settledRun, "owner", 60_000),
    ).toContain("RUNNING");
    expect(
      await control.settle({
        actualMicrodollars: 400_000n,
        budgetPeriodId: lifecyclePeriod,
        runId: settledRun,
        settlementId: "settlement-1",
        tenantId: lifecycleTenant,
      }),
    ).toContain("SETTLED");
    expect(
      await control.settle({
        actualMicrodollars: 400_000n,
        budgetPeriodId: lifecyclePeriod,
        runId: settledRun,
        settlementId: "settlement-1",
        tenantId: lifecycleTenant,
      }),
    ).toContain("ALREADY_APPLIED");
    expect(
      await control.cancel(
        lifecycleTenant,
        lifecyclePeriod,
        cancelledRun,
        "test",
      ),
    ).toContain("CANCELLED");
    expect(
      await control.cancel(
        lifecycleTenant,
        lifecyclePeriod,
        cancelledRun,
        "test",
      ),
    ).toContain("ALREADY_CANCELLED");

    const state = await control.budgetState(lifecycleTenant, lifecyclePeriod);
    expect(state.active).toBe(0);
    expect(state.reservedMicrodollars).toBe(0n);
    expect(state.spentMicrodollars).toBe(400_000n);
  });

  it("restores durable active state after projection loss", async () => {
    const recoveryTenant = `test-${randomUUID()}`;
    const recoveryPeriod = randomUUID();
    const runId = randomUUID();
    await control.initializeBudget({
      active: 1,
      budgetPeriodId: recoveryPeriod,
      concurrency: 2,
      limitMicrodollars: 1_000_000n,
      reservedMicrodollars: 250_000n,
      tenantId: recoveryTenant,
    });
    await control.restoreRun({
      amountMicrodollars: 250_000n,
      budgetPeriodId: recoveryPeriod,
      expiresAt: Date.now() + 60_000,
      idempotencyDigest: "restored-request",
      idempotencyTtlMs: 60_000,
      runId,
      status: "RUNNING",
      tenantId: recoveryTenant,
    });
    expect(await control.runState(recoveryTenant, runId)).toMatchObject({
      amount: "250000",
      budget_period_id: recoveryPeriod,
      status: "RUNNING",
    });
  });
});
