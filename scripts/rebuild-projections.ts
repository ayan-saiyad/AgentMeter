import { parseConfig, workerConfigSchema } from "@agentmeter/config";
import { database } from "@agentmeter/database";
import {
  createRedisControl,
  initializeCurrentBudgets,
  loadFunctionLibrary,
} from "@agentmeter/redis-control";

const config = parseConfig(workerConfigSchema);
const redis = await createRedisControl(config.REDIS_URL);

try {
  await loadFunctionLibrary(redis.client);
  await initializeCurrentBudgets(database, redis, {
    force: true,
    leaseTtlMs: config.LEASE_TTL_MS,
  });
  console.log("Redis projections rebuilt from durable state.");
} finally {
  await Promise.all([database.$disconnect(), redis.client.quit()]);
}
