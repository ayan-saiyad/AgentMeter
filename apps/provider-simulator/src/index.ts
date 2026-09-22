import { parseConfig, simulatorConfigSchema } from "@agentmeter/config";
import { buildSimulator } from "./app.js";

const config = parseConfig(simulatorConfigSchema);
const app = buildSimulator();

const stop = async () => {
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

await app.listen({ host: "0.0.0.0", port: config.SIMULATOR_PORT });
