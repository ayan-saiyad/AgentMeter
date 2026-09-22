import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { providerRequestSchema, serviceVersion } from "@agentmeter/contracts";
import Fastify from "fastify";

const chunks = ["Governed ", "runtime ", "completed ", "successfully."];

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function buildSimulator() {
  const app = Fastify({ logger: true });

  app.get("/health/live", () => ({
    service: "provider-simulator",
    status: "ok" as const,
    version: serviceVersion,
  }));

  app.post("/v1/stream", async (request, reply) => {
    const body = providerRequestSchema.parse(request.body);
    const delayMs = Number(request.headers["x-simulator-delay-ms"] ?? 10);
    const providerRequestId = randomUUID();
    const stream = Readable.from(
      (async function* () {
        for (const text of chunks) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          yield line({ type: "message.delta", text });
        }
        yield line({
          type: "usage.final",
          cachedTokens: 0,
          inputTokens: Math.max(1, Math.ceil(body.input.length / 4)),
          outputTokens: chunks.join("").length,
          toolCalls: 0,
        });
        yield line({ type: "provider.completed", providerRequestId });
      })(),
    );
    return reply.type("application/x-ndjson").send(stream);
  });

  return app;
}
