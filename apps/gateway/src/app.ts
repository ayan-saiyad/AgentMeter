import { serviceVersion } from "@agentmeter/contracts";
import { loggerOptions } from "@agentmeter/observability";
import Fastify from "fastify";

export function buildGateway() {
  const app = Fastify({ logger: loggerOptions });

  app.get("/health/live", () => ({
    service: "gateway",
    status: "ok" as const,
    version: serviceVersion,
  }));

  return app;
}
