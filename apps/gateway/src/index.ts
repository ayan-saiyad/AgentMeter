import { gatewayConfigSchema, parseConfig } from "@agentmeter/config";
import { database } from "@agentmeter/database";
import { SimulatorProvider } from "@agentmeter/providers";
import {
  createRedisControl,
  initializeCurrentBudgets,
  loadFunctionLibrary,
} from "@agentmeter/redis-control";
import { buildGateway } from "./app.js";

const config = parseConfig(gatewayConfigSchema);
const redis = await createRedisControl(config.REDIS_URL);
await loadFunctionLibrary(redis.client);
await initializeCurrentBudgets(database, redis);
const app = buildGateway({
  apiKeyPepper: config.API_KEY_PEPPER,
  database,
  leaseRenewMs: config.LEASE_RENEW_MS,
  leaseTtlMs: config.LEASE_TTL_MS,
  liveEventRetention: config.LIVE_EVENT_RETENTION,
  provider: new SimulatorProvider(config.SIMULATOR_URL),
  redis,
});

const stop = async () => {
  await app.close();
  await Promise.all([database.$disconnect(), redis.client.quit()]);
  process.exit(0);
};

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

await app.listen({ host: config.GATEWAY_HOST, port: config.GATEWAY_PORT });
