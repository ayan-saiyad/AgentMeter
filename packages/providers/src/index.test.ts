import { describe, expect, it } from "vitest";
import { SimulatorProvider } from "./index.js";

describe("provider adapter", () => {
  it("uses a conservative text estimate", () => {
    const provider = new SimulatorProvider("http://localhost");
    expect(provider.estimateInputTokens("")).toBe(1);
    expect(provider.estimateInputTokens("12345")).toBe(2);
  });
});
