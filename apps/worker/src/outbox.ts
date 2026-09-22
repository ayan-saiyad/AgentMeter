import type { Prisma, PrismaClient } from "@agentmeter/database";
import type { RedisControl } from "@agentmeter/redis-control";
import { z } from "zod";

const settlementPayloadSchema = z.object({
  actualMicrodollars: z.string().regex(/^\d+$/),
  budgetPeriodId: z.string().uuid(),
  reservedMicrodollars: z.string().regex(/^\d+$/),
  runId: z.string().uuid(),
  settlementId: z.string().uuid(),
  tenantId: z.string().uuid(),
});

interface ClaimedEvent {
  eventType: string;
  id: string;
  payload: Prisma.JsonValue;
}

export async function claimOutboxBatch(
  database: PrismaClient,
  workerId: string,
  limit = 25,
): Promise<ClaimedEvent[]> {
  return database.$transaction(async (transaction) => {
    await transaction.outboxEvent.updateMany({
      where: {
        status: "PROCESSING",
        lockedAt: { lt: new Date(Date.now() - 60_000) },
      },
      data: { status: "PENDING", lockedAt: null, lockedBy: null },
    });
    const rows = await transaction.$queryRaw<ClaimedEvent[]>`
      SELECT id, event_type AS "eventType", payload
      FROM outbox_event
      WHERE status = 'PENDING' AND next_attempt_at <= NOW()
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `;
    if (rows.length > 0) {
      await transaction.outboxEvent.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: {
          attempts: { increment: 1 },
          lockedAt: new Date(),
          lockedBy: workerId,
          status: "PROCESSING",
        },
      });
    }
    return rows;
  });
}

export async function processOutboxBatch(
  database: PrismaClient,
  redis: RedisControl,
  workerId: string,
  limit = 25,
): Promise<number> {
  const events = await claimOutboxBatch(database, workerId, limit);
  for (const event of events) {
    try {
      if (event.eventType !== "run.settled") {
        throw new Error(`Unsupported outbox event ${event.eventType}`);
      }
      const payload = settlementPayloadSchema.parse(event.payload);
      const result = await redis.settle({
        actualMicrodollars: BigInt(payload.actualMicrodollars),
        budgetPeriodId: payload.budgetPeriodId,
        runId: payload.runId,
        settlementId: payload.settlementId,
        tenantId: payload.tenantId,
      });
      if (!["SETTLED", "ALREADY_APPLIED"].includes(result[0] ?? "")) {
        throw new Error(`Redis settlement returned ${result.join(":")}`);
      }
      await database.outboxEvent.update({
        where: { id: event.id },
        data: {
          deliveredAt: new Date(),
          lastError: null,
          lockedAt: null,
          lockedBy: null,
          status: "DELIVERED",
        },
      });
    } catch (error) {
      const row = await database.outboxEvent.findUniqueOrThrow({
        where: { id: event.id },
        select: { attempts: true },
      });
      const dead = row.attempts >= 10;
      const backoffMs = Math.min(60_000, 2 ** row.attempts * 250);
      await database.outboxEvent.update({
        where: { id: event.id },
        data: {
          lastError:
            error instanceof Error ? error.message : "Unknown delivery error",
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: new Date(Date.now() + backoffMs),
          status: dead ? "DEAD" : "PENDING",
        },
      });
    }
  }
  return events.length;
}
