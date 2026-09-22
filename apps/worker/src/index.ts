import { parseConfig, workerConfigSchema } from "@agentmeter/config";

const config = parseConfig(workerConfigSchema);
let stopping = false;

const stop = () => {
  stopping = true;
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

while (!stopping) {
  await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
}
