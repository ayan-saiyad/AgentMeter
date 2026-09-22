import { describe, expect, it } from "vitest";
import { createApiKey, digestApiKey } from "./api-key.js";

describe("runtime keys", () => {
  it("creates opaque unique tokens", () => {
    const first = createApiKey();
    const second = createApiKey();
    expect(first.prefix).not.toBe(second.prefix);
    expect(first.token).not.toBe(second.token);
    expect(first.token.startsWith(`${first.prefix}_`)).toBe(true);
  });

  it("uses a pepper when deriving the lookup digest", () => {
    const token = "am_live_test_secret";
    expect(digestApiKey(token, "x".repeat(32))).not.toBe(
      digestApiKey(token, "y".repeat(32)),
    );
  });
});
