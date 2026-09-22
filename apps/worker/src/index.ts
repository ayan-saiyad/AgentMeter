import { parseConfig, workerConfigSchema } from "@agentmeter/config";
import { database } from "@agentmeter/database";
import {
  createRedisControl,
  initializeCurrentBudgets,
  loadFunctionLibrary,
} from "@agentmeter/redis-control";
import { randomUUID } from "node:crypto";
import { SimulatorProvider } from "@agentmeter/providers";
import { processOutboxBatch } from "./outbox.js";
import { reconcileCases, sweepExpiredLeases } from "./recovery.js";
import { refreshDailyRollups } from "./rollups.js";

const config = parseConfig(workerConfigSchema);
const redis = await createRedisControl(config.REDIS_URL);
await loadFunctionLibrary(redis.client);
await initializeCurrentBudgets(database, redis);
const workerId = `${process.pid}:${randomUUID()}`;
const provider = new SimulatorProvider(config.SIMULATOR_URL);
let stopping = false;
let nextLeaseSweep = 0;
let nextRollup = 0;

const stop = () => {
  stopping = true;
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

while (!stopping) {
  await processOutboxBatch(database, redis, workerId);
  const now = Date.now();
  if (now >= nextLeaseSweep) {
    await sweepExpiredLeases(
      database,
      redis,
      config.RECONCILIATION_DEADLINE_MS,
    );
    await reconcileCases(database, provider);
    nextLeaseSweep = now + config.LEASE_SWEEP_MS;
  }
  if (now >= nextRollup) {
    await refreshDailyRollups(database);
    nextRollup = now + 60_000;
  }
  await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
}

await Promise.all([database.$disconnect(), redis.client.quit()]);
