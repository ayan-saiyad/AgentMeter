import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "redis";

export type RedisClient = ReturnType<typeof createClient>;

const MAX_CONTROL_VALUE = 9_007_199_254_740_991n;
const tenantPattern = /^[A-Za-z0-9_-]{1,128}$/;

function assertTenant(tenantId: string): void {
  if (!tenantPattern.test(tenantId)) {
    throw new Error("Tenant identifier cannot be used in a Redis hash tag");
  }
}

function assertControlMoney(value: bigint): void {
  if (value < 0n || value > MAX_CONTROL_VALUE) {
    throw new RangeError("Money is outside the Redis control-plane range");
  }
}

export const keys = {
  budget(tenantId: string, periodId: string) {
    assertTenant(tenantId);
    return `am:{${tenantId}}:budget:${periodId}`;
  },
  idempotency(tenantId: string, digest: string) {
    assertTenant(tenantId);
    return `am:{${tenantId}}:idem:${digest}`;
  },
  leases(tenantId: string) {
    assertTenant(tenantId);
    return `am:{${tenantId}}:leases`;
  },
  live(tenantId: string) {
    assertTenant(tenantId);
    return `am:{${tenantId}}:live`;
  },
  run(tenantId: string, runId: string) {
    assertTenant(tenantId);
    return `am:{${tenantId}}:run:${runId}`;
  },
};

function strings(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error("Unexpected Redis Function response");
  }
  return value;
}

function stringRecord(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const raw = strings(value);
    const state: Record<string, string> = {};
    for (let index = 0; index < raw.length; index += 2) {
      const field = raw[index];
      const fieldValue = raw[index + 1];
      if (field !== undefined && fieldValue !== undefined)
        state[field] = fieldValue;
    }
    return state;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.every((entry) => typeof entry[1] === "string")) {
      return Object.fromEntries(entries) as Record<string, string>;
    }
  }
  throw new Error("Unexpected Redis hash response");
}

export interface BudgetState {
  active: number;
  admissionsOpen: boolean;
  concurrency: number;
  generation: number;
  limitMicrodollars: bigint;
  overageMicrodollars: bigint;
  reservedMicrodollars: bigint;
  spentMicrodollars: bigint;
}

export interface ReservationInput {
  amountMicrodollars: bigint;
  budgetPeriodId: string;
  idempotencyDigest: string;
  idempotencyTtlMs: number;
  leaseTtlMs: number;
  owner: string;
  runId: string;
  tenantId: string;
}

export interface ReservationResult {
  created: boolean;
  decision: "ACCEPTED" | "REJECTED";
  expiresAt?: number;
  fence?: number;
  reason?: string;
  runId: string;
  status: string;
}

export class RedisControl {
  constructor(readonly client: RedisClient) {}

  async initializeBudget(input: {
    active?: number;
    admissionsOpen?: boolean;
    budgetPeriodId: string;
    concurrency: number;
    generation?: number;
    limitMicrodollars: bigint;
    overageMicrodollars?: bigint;
    reservedMicrodollars?: bigint;
    spentMicrodollars?: bigint;
    tenantId: string;
  }): Promise<void> {
    for (const value of [
      input.limitMicrodollars,
      input.spentMicrodollars ?? 0n,
      input.reservedMicrodollars ?? 0n,
      input.overageMicrodollars ?? 0n,
    ]) {
      assertControlMoney(value);
    }
    await this.call(
      "agentmeter_initialize_budget",
      [keys.budget(input.tenantId, input.budgetPeriodId)],
      [
        input.limitMicrodollars.toString(),
        (input.spentMicrodollars ?? 0n).toString(),
        (input.reservedMicrodollars ?? 0n).toString(),
        String(input.active ?? 0),
        String(input.concurrency),
        String(input.generation ?? 1),
        input.admissionsOpen === false ? "0" : "1",
        (input.overageMicrodollars ?? 0n).toString(),
      ],
    );
  }

  async reserve(input: ReservationInput): Promise<ReservationResult> {
    assertControlMoney(input.amountMicrodollars);
    const response = strings(
      await this.call(
        "agentmeter_reserve_run",
        [
          keys.budget(input.tenantId, input.budgetPeriodId),
          keys.run(input.tenantId, input.runId),
          keys.idempotency(input.tenantId, input.idempotencyDigest),
          keys.leases(input.tenantId),
        ],
        [
          input.runId,
          input.amountMicrodollars.toString(),
          String(input.leaseTtlMs),
          String(input.idempotencyTtlMs),
          input.owner,
        ],
      ),
    );
    const result: ReservationResult = {
      created: response[2] === "1",
      decision: response[0] as "ACCEPTED" | "REJECTED",
      runId: response[1] ?? input.runId,
      status: response[3] ?? "UNKNOWN",
    };
    if (response[4]) result.reason = response[4];
    if (response[5]) result.fence = Number(response[5]);
    if (response[6]) result.expiresAt = Number(response[6]);
    return result;
  }

  async markRunning(
    tenantId: string,
    runId: string,
    owner: string,
    leaseTtlMs: number,
  ): Promise<string[]> {
    return strings(
      await this.call(
        "agentmeter_mark_running",
        [keys.run(tenantId, runId), keys.leases(tenantId)],
        [owner, String(leaseTtlMs)],
      ),
    );
  }

  async renewLease(
    tenantId: string,
    runId: string,
    owner: string,
    fence: number,
    leaseTtlMs: number,
  ): Promise<string[]> {
    return strings(
      await this.call(
        "agentmeter_renew_lease",
        [keys.run(tenantId, runId), keys.leases(tenantId)],
        [owner, String(fence), String(leaseTtlMs)],
      ),
    );
  }

  async cancel(
    tenantId: string,
    budgetPeriodId: string,
    runId: string,
    reason: string,
  ): Promise<string[]> {
    return strings(
      await this.call(
        "agentmeter_cancel_reservation",
        [
          keys.budget(tenantId, budgetPeriodId),
          keys.run(tenantId, runId),
          keys.leases(tenantId),
        ],
        [reason],
      ),
    );
  }

  async hold(
    tenantId: string,
    runId: string,
    reason: string,
  ): Promise<string[]> {
    return strings(
      await this.call(
        "agentmeter_hold_for_reconciliation",
        [keys.run(tenantId, runId), keys.leases(tenantId)],
        [reason],
      ),
    );
  }

  async settle(input: {
    actualMicrodollars: bigint;
    budgetPeriodId: string;
    runId: string;
    settlementId: string;
    tenantId: string;
  }): Promise<string[]> {
    assertControlMoney(input.actualMicrodollars);
    return strings(
      await this.call(
        "agentmeter_settle_run",
        [
          keys.budget(input.tenantId, input.budgetPeriodId),
          keys.run(input.tenantId, input.runId),
          keys.leases(input.tenantId),
        ],
        [input.settlementId, input.actualMicrodollars.toString()],
      ),
    );
  }

  async dueLeases(
    tenantId: string,
    beforeMs = Date.now(),
    limit = 100,
  ): Promise<string[]> {
    const result = await this.client.sendCommand([
      "ZRANGEBYSCORE",
      keys.leases(tenantId),
      "-inf",
      String(beforeMs),
      "LIMIT",
      "0",
      String(limit),
    ]);
    return strings(result);
  }

  async budgetState(
    tenantId: string,
    budgetPeriodId: string,
  ): Promise<BudgetState> {
    const response: unknown = await this.client.sendCommand([
      "HGETALL",
      keys.budget(tenantId, budgetPeriodId),
    ]);
    const state = stringRecord(response);
    return {
      active: Number(state.active ?? 0),
      admissionsOpen: state.admissions_open === "1",
      concurrency: Number(state.concurrency ?? 0),
      generation: Number(state.generation ?? 0),
      limitMicrodollars: BigInt(state.limit ?? 0),
      overageMicrodollars: BigInt(state.overage ?? 0),
      reservedMicrodollars: BigInt(state.reserved ?? 0),
      spentMicrodollars: BigInt(state.spent ?? 0),
    };
  }

  async runState(
    tenantId: string,
    runId: string,
  ): Promise<Record<string, string>> {
    const response: unknown = await this.client.sendCommand([
      "HGETALL",
      keys.run(tenantId, runId),
    ]);
    return stringRecord(response);
  }

  async appendLiveEvent(
    tenantId: string,
    retention: number,
    fields: Record<string, string>,
  ): Promise<string> {
    const flattened = Object.entries(fields).flat();
    const response = await this.client.sendCommand([
      "XADD",
      keys.live(tenantId),
      "MAXLEN",
      "~",
      String(retention),
      "*",
      ...flattened,
    ]);
    if (typeof response !== "string")
      throw new Error("Redis did not return a stream identifier");
    return response;
  }

  private async call(
    name: string,
    functionKeys: string[],
    args: string[],
  ): Promise<unknown> {
    return this.client.sendCommand([
      "FCALL",
      name,
      String(functionKeys.length),
      ...functionKeys,
      ...args,
    ]);
  }
}

export async function createRedisControl(url: string): Promise<RedisControl> {
  const client = createClient({ url });
  await client.connect();
  return new RedisControl(client as RedisClient);
}

export async function loadFunctionLibrary(client: RedisClient): Promise<void> {
  const path = fileURLToPath(
    new URL("../../../redis/functions/agentmeter.lua", import.meta.url),
  );
  const source = await readFile(path, "utf8");
  await client.sendCommand(["FUNCTION", "LOAD", "REPLACE", source]);
}
