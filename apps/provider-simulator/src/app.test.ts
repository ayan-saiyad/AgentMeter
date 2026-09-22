import { afterEach, describe, expect, it } from "vitest";
import { buildSimulator } from "./app.js";

describe("provider simulator", () => {
  const apps: ReturnType<typeof buildSimulator>[] = [];
  afterEach(async () =>
    Promise.all(apps.splice(0).map(async (app) => app.close())),
  );

  it("streams deterministic usage", async () => {
    const app = buildSimulator();
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/stream",
      payload: {
        input: "hello",
        maxDurationMs: 10_000,
        maxOutputTokens: 100,
        model: "simulator-v1",
        runId: "00000000-0000-4000-8000-000000000010",
        tools: [],
      },
    });
    expect(response.statusCode).toBe(200);
    const events = response.body
      .trim()
      .split("\n")
      .map((value) => JSON.parse(value) as { type: string });
    expect(events.at(-2)?.type).toBe("usage.final");
    expect(events.at(-1)?.type).toBe("provider.completed");
  });
});
