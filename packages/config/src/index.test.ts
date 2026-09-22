import { describe, expect, it } from "vitest";
import { gatewayConfigSchema, parseConfig } from "./index.js";

describe("configuration", () => {
  it("coerces gateway settings", () => {
    const config = parseConfig(gatewayConfigSchema, {
      API_KEY_PEPPER: "x".repeat(32),
      DATABASE_URL: "postgresql://example",
      GATEWAY_PORT: "4567",
      REDIS_URL: "redis://example",
    });

    expect(config.GATEWAY_PORT).toBe(4567);
    expect(config.LEASE_TTL_MS).toBe(90_000);
  });

  it("rejects short secrets", () => {
    expect(() =>
      parseConfig(gatewayConfigSchema, {
        API_KEY_PEPPER: "short",
        DATABASE_URL: "postgresql://example",
        REDIS_URL: "redis://example",
      }),
    ).toThrow("Invalid configuration");
  });
});
