import { parseConfig, simulatorConfigSchema } from "@agentmeter/config";
import { serviceVersion } from "@agentmeter/contracts";
import Fastify from "fastify";

const config = parseConfig(simulatorConfigSchema);
const app = Fastify({ logger: true });

app.get("/health/live", () => ({
  service: "provider-simulator",
  status: "ok" as const,
  version: serviceVersion,
}));

const stop = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

await app.listen({ host: "0.0.0.0", port: config.SIMULATOR_PORT });
