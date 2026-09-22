import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  claimRun,
  createReservedRun,
  database,
  finalizeRun,
} from "@agentmeter/database";

const enabled = Boolean(process.env.DATABASE_URL);
const integration = enabled ? describe : describe.skip;

integration("durable run accounting", () => {
  const runId = randomUUID();
  const tenantId = "00000000-0000-4000-8000-000000000001";

  afterAll(async () => database.$disconnect());

  it("claims and settles once", async () => {
    await createReservedRun(database, {
      id: runId,
      tenantId,
      applicationId: "00000000-0000-4000-8000-000000000002",
      budgetPeriodId: "00000000-0000-4000-8000-000000000004",
      idempotencyDigest: `integration-${runId}`,
      maxDurationMs: 10_000,
      maxOutputTokens: 100,
      model: "simulator-v1",
      modelPriceId: "00000000-0000-4000-8000-000000000007",
      policySnapshot: { test: true },
      policyVersionId: "00000000-0000-4000-8000-000000000006",
      priceSnapshot: { test: true },
      provider: "simulator",
      reservedMicrodollars: 100n,
    });

    await expect(claimRun(database, runId, "integration-worker")).resolves.toBe(
      true,
    );
    await expect(claimRun(database, runId, "other-worker")).resolves.toBe(
      false,
    );

    const first = await finalizeRun(database, runId, {
      actualMicrodollars: 50n,
      evidence: "PROVIDER_FINAL",
      inputTokens: 10,
      outputTokens: 20,
      sequence: 1,
      toolCalls: 0,
    });
    const duplicate = await finalizeRun(database, runId, {
      actualMicrodollars: 50n,
      evidence: "PROVIDER_FINAL",
      inputTokens: 10,
      outputTokens: 20,
      sequence: 1,
      toolCalls: 0,
    });

    expect(duplicate.id).toBe(first.id);
    expect(first.unusedMicrodollars).toBe(50n);
    await expect(database.settlement.count({ where: { runId } })).resolves.toBe(
      1,
    );
    await expect(
      database.outboxEvent.count({ where: { aggregateId: runId } }),
    ).resolves.toBe(1);
  });

  it("prevents mutation of usage evidence", async () => {
    const event = await database.usageEvent.findFirstOrThrow({
      where: { runId },
    });
    await expect(
      database.usageEvent.update({
        where: { id: event.id },
        data: { inputTokens: event.inputTokens + 1 },
      }),
    ).rejects.toThrow("append-only");
  });
});
