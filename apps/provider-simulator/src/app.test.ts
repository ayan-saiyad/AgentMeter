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
    expect(events[0]?.type).toBe("provider.started");
    const started = JSON.parse(response.body.trim().split("\n")[0] ?? "{}") as {
      providerRequestId: string;
    };
    const usage = await app.inject({
      method: "GET",
      url: `/v1/usage/${started.providerRequestId}`,
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({ inputTokens: 2, toolCalls: 0 });
  });

  it("emits a requested tool call", async () => {
    const app = buildSimulator();
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/stream",
      payload: {
        input: "check stock",
        maxDurationMs: 10_000,
        maxOutputTokens: 100,
        model: "simulator-v1",
        runId: "00000000-0000-4000-8000-000000000011",
        tools: ["inventory.lookup"],
      },
    });
    expect(response.body).toContain('"type":"tool.call"');
    expect(response.body).toContain('"toolCalls":1');
  });
});
