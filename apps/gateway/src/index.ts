import { gatewayConfigSchema, parseConfig } from "@agentmeter/config";
import { buildGateway } from "./app.js";

const config = parseConfig(gatewayConfigSchema);
const app = buildGateway();

const stop = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

await app.listen({ host: config.GATEWAY_HOST, port: config.GATEWAY_PORT });
