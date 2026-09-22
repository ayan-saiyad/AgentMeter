export { Prisma, PrismaClient } from "@prisma/client";
export { createApiKey, digestApiKey, findApiKey } from "./api-key.js";
export { claimRun, createReservedRun, finalizeRun } from "./runs.js";

import { PrismaClient } from "@prisma/client";

const globalDatabase = globalThis as typeof globalThis & {
  agentMeterDatabase?: PrismaClient;
};

export const database = globalDatabase.agentMeterDatabase ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.agentMeterDatabase = database;
}
