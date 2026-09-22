import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  providerRequestSchema,
  serviceVersion,
  type ProviderUsage,
} from "@agentmeter/contracts";
import Fastify from "fastify";

const chunks = ["Governed ", "runtime ", "completed ", "successfully."];

interface StoredUsage {
  availableAt: number;
  usage: ProviderUsage;
}

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function buildSimulator() {
  const app = Fastify({ logger: true });
  const usage = new Map<string, StoredUsage>();

  app.get("/health/live", () => ({
    service: "provider-simulator",
    status: "ok" as const,
    version: serviceVersion,
  }));

  app.post("/v1/stream", async (request, reply) => {
    const body = providerRequestSchema.parse(request.body);
    const delayMs = Number(
      body.metadata?.["simulatorDelayMs"] ??
        request.headers["x-simulator-delay-ms"] ??
        10,
    );
    const providerRequestId = randomUUID();
    const toolName = body.tools[0];
    const finalUsage: ProviderUsage = {
      cachedTokens: 0,
      inputTokens: Math.max(1, Math.ceil(body.input.length / 4)),
      outputTokens: chunks.join("").length,
      toolCalls: toolName ? 1 : 0,
    };
    const completionDelay = delayMs * (chunks.length + (toolName ? 1 : 0));
    usage.set(providerRequestId, {
      availableAt: Date.now() + completionDelay,
      usage: finalUsage,
    });
    const stream = Readable.from(
      (async function* () {
        yield line({ type: "provider.started", providerRequestId });
        if (body.metadata?.["simulatorFailure"] === "after-start") {
          throw new Error("SIMULATED_PROVIDER_FAILURE");
        }
        if (toolName) {
          yield line({
            type: "tool.call",
            callId: randomUUID(),
            name: toolName,
            arguments:
              toolName === "weather.lookup"
                ? { location: "Chicago" }
                : { sku: "demo-item" },
          });
        }
        for (const text of chunks) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          yield line({ type: "message.delta", text });
        }
        yield line({ type: "usage.final", ...finalUsage });
        yield line({ type: "provider.completed", providerRequestId });
      })(),
    );
    return reply.type("application/x-ndjson").send(stream);
  });

  app.get<{ Params: { providerRequestId: string } }>(
    "/v1/usage/:providerRequestId",
    async (request, reply) => {
      const record = usage.get(request.params.providerRequestId);
      if (!record || record.availableAt > Date.now()) {
        return reply.code(404).send({ code: "USAGE_PENDING" });
      }
      return record.usage;
    },
  );

  return app;
}
