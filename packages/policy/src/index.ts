import type { ModelPrice, PolicyRules, RunStatus } from "@agentmeter/contracts";

const PER_MILLION = 1_000_000n;
const MAX_CONTROL_VALUE = 9_007_199_254_740_991n;

export interface CostBoundInput {
  estimatedInputTokens: number;
  maxOutputTokens: number;
  maxToolCalls: number;
  price: ModelPrice;
  safetyBasisPoints?: number;
}

export function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (value < 0n || divisor <= 0n) {
    throw new RangeError(
      "ceilDiv requires a non-negative value and positive divisor",
    );
  }
  return (value + divisor - 1n) / divisor;
}

export function computeCostBound(input: CostBoundInput): bigint {
  const safetyBasisPoints = input.safetyBasisPoints ?? 500;
  for (const value of [
    input.estimatedInputTokens,
    input.maxOutputTokens,
    input.maxToolCalls,
    safetyBasisPoints,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("Cost inputs must be non-negative safe integers");
    }
  }

  const inputCost = ceilDiv(
    BigInt(input.estimatedInputTokens) *
      BigInt(input.price.inputPerMillionMicrodollars),
    PER_MILLION,
  );
  const outputCost = ceilDiv(
    BigInt(input.maxOutputTokens) *
      BigInt(input.price.outputPerMillionMicrodollars),
    PER_MILLION,
  );
  const toolCost =
    BigInt(input.maxToolCalls) * BigInt(input.price.toolCallMicrodollars);
  const base = inputCost + outputCost + toolCost;
  const withMargin = ceilDiv(
    base * BigInt(10_000 + safetyBasisPoints),
    10_000n,
  );

  if (withMargin > MAX_CONTROL_VALUE) {
    throw new RangeError("Cost bound exceeds the control-plane range");
  }
  return withMargin;
}

export interface PolicyRequest {
  maxDurationMs: number;
  maxOutputTokens: number;
  model: string;
  tools: string[];
}

export type PolicyDecision =
  | { allowed: true; effective: PolicyRules }
  | { allowed: false; code: string; detail: string };

export function evaluatePolicy(
  rules: PolicyRules,
  request: PolicyRequest,
): PolicyDecision {
  if (!rules.allowedModels.includes(request.model)) {
    return {
      allowed: false,
      code: "MODEL_DENIED",
      detail: `Model ${request.model} is not allowed`,
    };
  }
  const deniedTool = request.tools.find(
    (tool) => !rules.allowedTools.includes(tool),
  );
  if (deniedTool) {
    return {
      allowed: false,
      code: "TOOL_DENIED",
      detail: `Tool ${deniedTool} is not allowed`,
    };
  }
  if (request.maxOutputTokens > rules.maxOutputTokens) {
    return {
      allowed: false,
      code: "TOKEN_LIMIT",
      detail: "Requested output exceeds the policy limit",
    };
  }
  if (request.maxDurationMs > rules.maxDurationMs) {
    return {
      allowed: false,
      code: "DURATION_LIMIT",
      detail: "Requested duration exceeds the policy limit",
    };
  }
  return { allowed: true, effective: rules };
}

const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  RESERVED: ["RUNNING", "CANCELLED", "EXPIRED"],
  RUNNING: ["SETTLED", "ABORTED", "FAILED", "RECONCILING"],
  ABORTED: ["RECONCILING", "SETTLED"],
  FAILED: ["RECONCILING", "SETTLED"],
  EXPIRED: ["CANCELLED", "RECONCILING"],
  RECONCILING: ["SETTLED"],
  SETTLED: [],
  CANCELLED: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return transitions[from].includes(to);
}
