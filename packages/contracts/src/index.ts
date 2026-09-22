import { z } from "zod";

export const healthSchema = z.object({
  service: z.string(),
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
});

export type Health = z.infer<typeof healthSchema>;

export const serviceVersion = "0.1.0";

export const moneySchema = z
  .string()
  .regex(/^\d+$/, "Money must be a non-negative integer string")
  .refine(
    (value) => BigInt(value) <= 9_007_199_254_740_991n,
    "Money exceeds the safe control-plane range",
  );

export const policyRulesSchema = z.object({
  allowedModels: z.array(z.string().min(1)).min(1),
  allowedTools: z.array(z.string().min(1)).default([]),
  maxConcurrency: z.number().int().positive(),
  maxDurationMs: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxRunMicrodollars: moneySchema,
  maxToolCalls: z.number().int().nonnegative().default(0),
});

export type PolicyRules = z.infer<typeof policyRulesSchema>;

export const modelPriceSchema = z.object({
  cachedPerMillionMicrodollars: moneySchema.default("0"),
  inputPerMillionMicrodollars: moneySchema,
  outputPerMillionMicrodollars: moneySchema,
  toolCallMicrodollars: moneySchema.default("0"),
});

export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const runStatusSchema = z.enum([
  "RESERVED",
  "RUNNING",
  "ABORTED",
  "FAILED",
  "EXPIRED",
  "RECONCILING",
  "SETTLED",
  "CANCELLED",
]);

export type RunStatus = z.infer<typeof runStatusSchema>;

export const runRequestSchema = z.object({
  input: z.string().min(1).max(200_000),
  maxDurationMs: z.number().int().min(100).max(600_000),
  maxOutputTokens: z.number().int().min(1).max(100_000),
  metadata: z.record(z.string(), z.string().max(500)).optional(),
  model: z.string().min(1).max(200),
  tools: z.array(z.string().min(1).max(200)).max(50).default([]),
});

export type RunRequest = z.infer<typeof runRequestSchema>;

export const providerRequestSchema = runRequestSchema.extend({
  runId: z.string().uuid(),
});

export type ProviderRequest = z.infer<typeof providerRequestSchema>;

export const providerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("provider.started"),
    providerRequestId: z.string(),
  }),
  z.object({ type: z.literal("message.delta"), text: z.string() }),
  z.object({
    type: z.literal("tool.call"),
    callId: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("usage.final"),
    cachedTokens: z.number().int().nonnegative().default(0),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative().default(0),
  }),
  z.object({
    type: z.literal("provider.completed"),
    providerRequestId: z.string(),
  }),
]);

export type ProviderEvent = z.infer<typeof providerEventSchema>;

export const providerUsageSchema = z.object({
  cachedTokens: z.number().int().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative().default(0),
});

export type ProviderUsage = z.infer<typeof providerUsageSchema>;

export interface RunEvent {
  data: Record<string, unknown>;
  runId: string;
  sequence: number;
  timestamp: string;
  type: string;
  version: 1;
}
