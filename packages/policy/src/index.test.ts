import { describe, expect, it } from "vitest";
import { canTransition, computeCostBound, evaluatePolicy } from "./index.js";

const rules = {
  allowedModels: ["simulator-v1"],
  allowedTools: ["weather.lookup"],
  maxConcurrency: 5,
  maxDurationMs: 60_000,
  maxOutputTokens: 1_000,
  maxRunMicrodollars: "1000000",
  maxToolCalls: 2,
};

describe("cost bounds", () => {
  it("rounds token dimensions upward and adds a margin", () => {
    const value = computeCostBound({
      estimatedInputTokens: 1,
      maxOutputTokens: 1,
      maxToolCalls: 1,
      price: {
        cachedPerMillionMicrodollars: "0",
        inputPerMillionMicrodollars: "1000000",
        outputPerMillionMicrodollars: "2000000",
        toolCallMicrodollars: "10",
      },
      safetyBasisPoints: 500,
    });
    expect(value).toBe(14n);
  });

  it("rejects invalid numeric inputs", () => {
    expect(() =>
      computeCostBound({
        estimatedInputTokens: -1,
        maxOutputTokens: 1,
        maxToolCalls: 0,
        price: {
          cachedPerMillionMicrodollars: "0",
          inputPerMillionMicrodollars: "1",
          outputPerMillionMicrodollars: "1",
          toolCallMicrodollars: "0",
        },
      }),
    ).toThrow(RangeError);
  });
});

describe("policy evaluation", () => {
  it("uses stable denial codes", () => {
    expect(
      evaluatePolicy(rules, {
        maxDurationMs: 10_000,
        maxOutputTokens: 50,
        model: "blocked",
        tools: [],
      }),
    ).toMatchObject({ allowed: false, code: "MODEL_DENIED" });
  });

  it("allows requests inside every bound", () => {
    expect(
      evaluatePolicy(rules, {
        maxDurationMs: 10_000,
        maxOutputTokens: 50,
        model: "simulator-v1",
        tools: ["weather.lookup"],
      }),
    ).toMatchObject({ allowed: true });
  });
});

describe("run transitions", () => {
  it("keeps terminal states terminal", () => {
    expect(canTransition("SETTLED", "RUNNING")).toBe(false);
    expect(canTransition("CANCELLED", "RUNNING")).toBe(false);
  });

  it("supports reconciliation", () => {
    expect(canTransition("ABORTED", "RECONCILING")).toBe(true);
    expect(canTransition("RECONCILING", "SETTLED")).toBe(true);
  });
});
