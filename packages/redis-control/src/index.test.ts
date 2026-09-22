import { describe, expect, it } from "vitest";
import { keys } from "./index.js";

describe("Redis keys", () => {
  it("keeps all tenant keys in one hash slot", () => {
    const tenantId = "tenant-123";
    expect([
      keys.budget(tenantId, "period"),
      keys.idempotency(tenantId, "digest"),
      keys.leases(tenantId),
      keys.live(tenantId),
      keys.run(tenantId, "run"),
    ]).toEqual([
      "am:{tenant-123}:budget:period",
      "am:{tenant-123}:idem:digest",
      "am:{tenant-123}:leases",
      "am:{tenant-123}:live",
      "am:{tenant-123}:run:run",
    ]);
  });

  it("rejects unsafe hash tags", () => {
    expect(() => keys.leases("bad}tenant")).toThrow();
  });
});
