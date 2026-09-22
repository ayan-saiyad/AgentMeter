export interface DashboardData {
  budget: {
    active: number;
    available: string;
    limit: string;
    reserved: string;
    spent: string;
  };
  daily: Array<{
    cost: string;
    day: string;
    failed: number;
    runs: number;
    success: number;
  }>;
  forecast: string;
  generatedAt: string;
  live: Array<{
    id: string;
    runId: string;
    timestamp: string;
    type: string;
  }>;
  operations: {
    errorRate: number;
    openReconciliations: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    pendingSettlements: number;
    settlementDelayMs: number | null;
  };
  policies: Array<{
    bindingId: string;
    name: string;
    rules: Record<string, unknown>;
    version: number;
  }>;
  recentRuns: Array<{
    application: string;
    cost: string;
    createdAt: string;
    id: string;
    model: string;
    status: string;
  }>;
  rejections: Array<{ count: number; reason: string }>;
  spendByApplication: Array<{ cost: string; name: string }>;
  spendByModel: Array<{ cost: string; name: string }>;
  spendByTool: Array<{ cost: string; name: string; uses: number }>;
  statuses: Array<{ count: number; status: string }>;
  tenant: { id: string; name: string };
}
