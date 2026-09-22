import { afterEach, describe, expect, it } from "vitest";
import { buildGateway } from "./app.js";

describe("gateway health", () => {
  const apps: ReturnType<typeof buildGateway>[] = [];

  afterEach(async () =>
    Promise.all(apps.splice(0).map(async (app) => app.close())),
  );

  it("reports liveness", async () => {
    const app = buildGateway();
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: "gateway", status: "ok" });
  });
});
