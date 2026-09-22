import { database } from "@agentmeter/database";
import {
  createRedisControl,
  type LiveEvent,
  type RedisControl,
} from "@agentmeter/redis-control";
import type { DashboardData } from "./types";

const activeStatuses = [
  "RESERVED",
  "RUNNING",
  "ABORTED",
  "FAILED",
  "EXPIRED",
  "RECONCILING",
] as const;

const globalRedis = globalThis as typeof globalThis & {
  agentMeterDashboardRedis?: Promise<RedisControl>;
};

function redisConnection(): Promise<RedisControl> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required");
  globalRedis.agentMeterDashboardRedis ??= createRedisControl(url);
  return globalRedis.agentMeterDashboardRedis;
}

function money(value: bigint | null | undefined): string {
  return (value ?? 0n).toString();
}

export async function dashboardTenant() {
  const configured = process.env.DASHBOARD_TENANT_ID;
  const tenant = configured
    ? await database.tenant.findUnique({ where: { id: configured } })
    : await database.tenant.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
      });
  if (!tenant) throw new Error("No dashboard tenant is configured");
  return tenant;
}

export async function getDashboardData(): Promise<DashboardData> {
  const tenant = await dashboardTenant();
  const now = new Date();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  const period = await database.budgetPeriod.findFirst({
    where: {
      tenantId: tenant.id,
      startsAt: { lte: now },
      endsAt: { gt: now },
      budget: { status: "ACTIVE" },
    },
    orderBy: { startsAt: "desc" },
  });
  if (!period) throw new Error("No active budget period is configured");

  const [
    settled,
    active,
    statuses,
    runs,
    rejections,
    reconciliations,
    pendingSettlements,
    daily,
    modelSpend,
    applicationSpend,
    toolSpend,
    bindings,
    settledRuns,
  ] = await Promise.all([
    database.settlement.aggregate({
      where: { tenantId: tenant.id, run: { budgetPeriodId: period.id } },
      _sum: { actualMicrodollars: true },
    }),
    database.agentRun.findMany({
      where: {
        tenantId: tenant.id,
        budgetPeriodId: period.id,
        status: { in: [...activeStatuses] },
      },
      select: { reservedMicrodollars: true },
    }),
    database.agentRun.groupBy({
      by: ["status"],
      where: { tenantId: tenant.id, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    database.agentRun.findMany({
      where: { tenantId: tenant.id },
      include: { application: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    database.admissionEvent.groupBy({
      by: ["reason"],
      where: {
        tenantId: tenant.id,
        decision: "REJECTED",
        createdAt: { gte: since },
      },
      _count: { _all: true },
      orderBy: { _count: { reason: "desc" } },
      take: 8,
    }),
    database.reconciliationCase.count({
      where: {
        tenantId: tenant.id,
        status: { in: ["OPEN", "RETRYING", "MANUAL_REVIEW"] },
      },
    }),
    database.outboxEvent.count({
      where: { tenantId: tenant.id, status: { in: ["PENDING", "PROCESSING"] } },
    }),
    database.dailyUsageRollup.groupBy({
      by: ["day"],
      where: { tenantId: tenant.id, day: { gte: since } },
      _sum: {
        costMicrodollars: true,
        failedCount: true,
        runCount: true,
        successCount: true,
      },
      _max: { p50LatencyMs: true, p95LatencyMs: true, p99LatencyMs: true },
      orderBy: { day: "asc" },
    }),
    database.agentRun.groupBy({
      by: ["model"],
      where: { tenantId: tenant.id, createdAt: { gte: since } },
      _sum: { actualMicrodollars: true },
      orderBy: { _sum: { actualMicrodollars: "desc" } },
    }),
    database.agentRun.groupBy({
      by: ["applicationId"],
      where: { tenantId: tenant.id, createdAt: { gte: since } },
      _sum: { actualMicrodollars: true },
      orderBy: { _sum: { actualMicrodollars: "desc" } },
    }),
    database.toolInvocation.groupBy({
      by: ["toolName"],
      where: { tenantId: tenant.id, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { costMicrodollars: true },
      orderBy: { _count: { toolName: "desc" } },
    }),
    database.policyBinding.findMany({
      where: { tenantId: tenant.id, enabled: true },
      include: { policy: true, policyVersion: true },
      orderBy: { priority: "desc" },
    }),
    database.agentRun.findMany({
      where: {
        tenantId: tenant.id,
        settledAt: { not: null },
        createdAt: { gte: since },
      },
      select: { createdAt: true, settledAt: true },
      orderBy: { settledAt: "desc" },
      take: 500,
    }),
  ]);

  const applications = await database.application.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const applicationNames = new Map(
    applications.map((item) => [item.id, item.name]),
  );
  const spent = settled._sum.actualMicrodollars ?? 0n;
  const reserved = active.reduce(
    (total, run) => total + run.reservedMicrodollars,
    0n,
  );
  const available =
    period.limitMicrodollars > spent + reserved
      ? period.limitMicrodollars - spent - reserved
      : 0n;
  const elapsed = Math.max(1, now.getTime() - period.startsAt.getTime());
  const duration = period.endsAt.getTime() - period.startsAt.getTime();
  const forecast = (spent * BigInt(Math.ceil(duration / elapsed))).toString();
  const latency = daily.at(-1)?._max;
  const failureCount = statuses
    .filter((item) => ["FAILED", "EXPIRED", "CANCELLED"].includes(item.status))
    .reduce((total, item) => total + item._count._all, 0);
  const runCount = statuses.reduce(
    (total, item) => total + item._count._all,
    0,
  );
  const delays = settledRuns.flatMap((run) =>
    run.settledAt ? [run.settledAt.getTime() - run.createdAt.getTime()] : [],
  );
  let live: LiveEvent[] = [];
  try {
    live = await (await redisConnection()).recentLiveEvents(tenant.id, 30);
  } catch {
    live = [];
  }

  return {
    budget: {
      active: active.length,
      available: available.toString(),
      limit: period.limitMicrodollars.toString(),
      reserved: reserved.toString(),
      spent: spent.toString(),
    },
    daily: daily.map((item) => ({
      cost: money(item._sum.costMicrodollars),
      day: item.day.toISOString().slice(0, 10),
      failed: item._sum.failedCount ?? 0,
      runs: item._sum.runCount ?? 0,
      success: item._sum.successCount ?? 0,
    })),
    forecast,
    generatedAt: now.toISOString(),
    live: live.map((item) => ({
      id: item.id,
      runId: item.runId,
      timestamp: item.timestamp,
      type: item.type,
    })),
    operations: {
      errorRate: runCount === 0 ? 0 : failureCount / runCount,
      openReconciliations: reconciliations,
      p50LatencyMs: latency?.p50LatencyMs ?? null,
      p95LatencyMs: latency?.p95LatencyMs ?? null,
      p99LatencyMs: latency?.p99LatencyMs ?? null,
      pendingSettlements,
      settlementDelayMs:
        delays.length === 0
          ? null
          : Math.round(delays.reduce((a, b) => a + b, 0) / delays.length),
    },
    policies: bindings.map((binding) => ({
      bindingId: binding.id,
      name: binding.policy.name,
      rules: binding.policyVersion.rules as Record<string, unknown>,
      version: binding.policyVersion.version,
    })),
    recentRuns: runs.map((run) => ({
      application: run.application.name,
      cost: run.actualMicrodollars.toString(),
      createdAt: run.createdAt.toISOString(),
      id: run.id,
      model: run.model,
      status: run.status,
    })),
    rejections: rejections.map((item) => ({
      count: item._count._all,
      reason: item.reason,
    })),
    spendByApplication: applicationSpend.map((item) => ({
      cost: money(item._sum.actualMicrodollars),
      name: applicationNames.get(item.applicationId) ?? item.applicationId,
    })),
    spendByModel: modelSpend.map((item) => ({
      cost: money(item._sum.actualMicrodollars),
      name: item.model,
    })),
    spendByTool: toolSpend.map((item) => ({
      cost: money(item._sum.costMicrodollars),
      name: item.toolName,
      uses: item._count._all,
    })),
    statuses: statuses.map((item) => ({
      count: item._count._all,
      status: item.status,
    })),
    tenant: { id: tenant.id, name: tenant.name },
  };
}
