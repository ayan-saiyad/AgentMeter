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
