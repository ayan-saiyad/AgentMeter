import { z } from "zod";

const commonSchema = z.object({
  API_KEY_PEPPER: z.string().min(32),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  REDIS_URL: z.string().min(1),
});

export const gatewayConfigSchema = commonSchema.extend({
  GATEWAY_HOST: z.string().default("0.0.0.0"),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LEASE_RENEW_MS: z.coerce.number().int().positive().default(30_000),
  LEASE_TTL_MS: z.coerce.number().int().positive().default(90_000),
  LIVE_EVENT_RETENTION: z.coerce.number().int().positive().default(1_000),
  SIMULATOR_URL: z.string().url().default("http://localhost:4100"),
});

export const workerConfigSchema = commonSchema.extend({
  LEASE_SWEEP_MS: z.coerce.number().int().positive().default(5_000),
  RECONCILIATION_DEADLINE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60 * 1_000),
  SIMULATOR_URL: z.string().url().default("http://localhost:4100"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1_000),
});

export const simulatorConfigSchema = z.object({
  SIMULATOR_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
});

export const dashboardConfigSchema = z.object({
  ADMIN_TOKEN: z.string().min(32),
  DATABASE_URL: z.string().min(1),
  DASHBOARD_TENANT_ID: z.string().uuid().optional(),
  REDIS_URL: z.string().min(1),
});

export function parseConfig<T>(
  schema: z.ZodType<T>,
  source: Record<string, string | undefined> = process.env,
): T {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
