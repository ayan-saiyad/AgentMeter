import type { PrismaClient } from "@agentmeter/database";

export async function refreshDailyRollups(
  database: PrismaClient,
): Promise<void> {
  await database.$executeRaw`
    INSERT INTO daily_usage_rollup (
      id, tenant_id, application_id, day, provider, model,
      run_count, success_count, failed_count, aborted_count,
      input_tokens, output_tokens, tool_calls, cost_microdollars,
      p50_latency_ms, p95_latency_ms, p99_latency_ms, updated_at
    )
    SELECT
      gen_random_uuid(), tenant_id, application_id,
      DATE_TRUNC('day', created_at)::date, provider, model,
      COUNT(*)::integer,
      COUNT(*) FILTER (WHERE status = 'SETTLED')::integer,
      COUNT(*) FILTER (WHERE status IN ('FAILED', 'EXPIRED', 'CANCELLED'))::integer,
      COUNT(*) FILTER (WHERE status = 'ABORTED')::integer,
      COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
      COALESCE(SUM(tool_calls), 0), COALESCE(SUM(actual_microdollars), 0),
      PERCENTILE_CONT(0.50) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (settled_at - created_at)) * 1000
      ) FILTER (WHERE settled_at IS NOT NULL)::integer,
      PERCENTILE_CONT(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (settled_at - created_at)) * 1000
      ) FILTER (WHERE settled_at IS NOT NULL)::integer,
      PERCENTILE_CONT(0.99) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (settled_at - created_at)) * 1000
      ) FILTER (WHERE settled_at IS NOT NULL)::integer,
      NOW()
    FROM agent_run
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY tenant_id, application_id, DATE_TRUNC('day', created_at)::date, provider, model
    ON CONFLICT (tenant_id, application_id, day, provider, model)
    DO UPDATE SET
      run_count = EXCLUDED.run_count,
      success_count = EXCLUDED.success_count,
      failed_count = EXCLUDED.failed_count,
      aborted_count = EXCLUDED.aborted_count,
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      tool_calls = EXCLUDED.tool_calls,
      cost_microdollars = EXCLUDED.cost_microdollars,
      p50_latency_ms = EXCLUDED.p50_latency_ms,
      p95_latency_ms = EXCLUDED.p95_latency_ms,
      p99_latency_ms = EXCLUDED.p99_latency_ms,
      updated_at = NOW()
  `;
}
