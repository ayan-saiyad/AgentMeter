import { parseConfig, workerConfigSchema } from "@agentmeter/config";
import { database } from "@agentmeter/database";
import {
  createRedisControl,
  initializeCurrentBudgets,
  loadFunctionLibrary,
} from "@agentmeter/redis-control";
import { randomUUID } from "node:crypto";
import { processOutboxBatch } from "./outbox.js";

const config = parseConfig(workerConfigSchema);
const redis = await createRedisControl(config.REDIS_URL);
await loadFunctionLibrary(redis.client);
await initializeCurrentBudgets(database, redis);
const workerId = `${process.pid}:${randomUUID()}`;
let stopping = false;

const stop = () => {
  stopping = true;
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

while (!stopping) {
  await processOutboxBatch(database, redis, workerId);
  await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
}

await Promise.all([database.$disconnect(), redis.client.quit()]);
