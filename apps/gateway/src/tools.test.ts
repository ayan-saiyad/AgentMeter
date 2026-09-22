import { describe, expect, it } from "vitest";
import { digestToolArguments, executeManagedTool } from "./tools.js";

describe("managed tools", () => {
  it("validates and executes registered tools", async () => {
    await expect(
      executeManagedTool("inventory.lookup", { sku: "demo" }),
    ).resolves.toMatchObject({ available: true, sku: "demo" });
    await expect(
      executeManagedTool("inventory.lookup", { sku: "" }),
    ).rejects.toThrow();
    await expect(executeManagedTool("unknown", {})).rejects.toThrow(
      "TOOL_NOT_REGISTERED",
    );
  });

  it("produces a stable argument digest", () => {
    expect(digestToolArguments({ sku: "demo" })).toBe(
      digestToolArguments({ sku: "demo" }),
    );
  });
});
