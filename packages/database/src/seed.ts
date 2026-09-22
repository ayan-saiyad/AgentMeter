import { PrismaClient } from "@prisma/client";
import { digestApiKey } from "./api-key.js";

const database = new PrismaClient();
const pepper =
  process.env.API_KEY_PEPPER ?? "local-development-pepper-change-me";
const token =
  process.env.SEED_API_KEY ?? "am_live_demo_7uHh9Km3nP2qR5sT8vW1xY4z";

const ids = {
  apiKey: "00000000-0000-4000-8000-000000000008",
  application: "00000000-0000-4000-8000-000000000002",
  budget: "00000000-0000-4000-8000-000000000003",
  budgetPeriod: "00000000-0000-4000-8000-000000000004",
  modelPrice: "00000000-0000-4000-8000-000000000007",
  policy: "00000000-0000-4000-8000-000000000005",
  policyBinding: "00000000-0000-4000-8000-000000000009",
  policyVersion: "00000000-0000-4000-8000-000000000006",
  tenant: "00000000-0000-4000-8000-000000000001",
};

const now = new Date();
const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const endsAt = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
);
const rules = {
  allowedModels: ["simulator-v1"],
  allowedTools: ["weather.lookup", "inventory.lookup"],
  maxConcurrency: 10,
  maxDurationMs: 120_000,
  maxOutputTokens: 4_096,
  maxRunMicrodollars: "1000000",
  maxToolCalls: 5,
};

await database.$transaction(async (transaction) => {
  await transaction.tenant.upsert({
    where: { id: ids.tenant },
    update: { name: "Demo Tenant", status: "ACTIVE" },
    create: { id: ids.tenant, name: "Demo Tenant" },
  });
  await transaction.application.upsert({
    where: { id: ids.application },
    update: { enabled: true, name: "Demo Application" },
    create: {
      id: ids.application,
      tenantId: ids.tenant,
      name: "Demo Application",
      slug: "demo",
    },
  });
  await transaction.budget.upsert({
    where: { id: ids.budget },
    update: { status: "ACTIVE" },
    create: {
      id: ids.budget,
      tenantId: ids.tenant,
      applicationId: ids.application,
      name: "Monthly runtime",
    },
  });
  await transaction.budgetPeriod.upsert({
    where: { id: ids.budgetPeriod },
    update: { endsAt, limitMicrodollars: 10_000_000n, startsAt },
    create: {
      id: ids.budgetPeriod,
      tenantId: ids.tenant,
      budgetId: ids.budget,
      startsAt,
      endsAt,
      limitMicrodollars: 10_000_000n,
    },
  });
  await transaction.policy.upsert({
    where: { id: ids.policy },
    update: { description: "Default runtime controls" },
    create: {
      id: ids.policy,
      tenantId: ids.tenant,
      name: "Default",
      description: "Default runtime controls",
    },
  });
  await transaction.policyVersion.upsert({
    where: { id: ids.policyVersion },
    update: { rules },
    create: {
      id: ids.policyVersion,
      tenantId: ids.tenant,
      policyId: ids.policy,
      version: 1,
      rules,
    },
  });
  await transaction.policyBinding.upsert({
    where: { id: ids.policyBinding },
    update: { enabled: true, policyVersionId: ids.policyVersion },
    create: {
      id: ids.policyBinding,
      tenantId: ids.tenant,
      policyId: ids.policy,
      policyVersionId: ids.policyVersion,
      targetType: "APPLICATION",
      targetId: ids.application,
      priority: 100,
    },
  });
  await transaction.modelPrice.upsert({
    where: { id: ids.modelPrice },
    update: { effectiveTo: null },
    create: {
      id: ids.modelPrice,
      tenantId: ids.tenant,
      provider: "simulator",
      model: "simulator-v1",
      inputPerMillionMicrodollars: 1_000_000n,
      outputPerMillionMicrodollars: 2_000_000n,
      toolCallMicrodollars: 10_000n,
      effectiveFrom: startsAt,
    },
  });
  await transaction.apiKey.upsert({
    where: { id: ids.apiKey },
    update: { secretDigest: digestApiKey(token, pepper), status: "ACTIVE" },
    create: {
      id: ids.apiKey,
      tenantId: ids.tenant,
      applicationId: ids.application,
      name: "Local demo",
      prefix: "am_live_demo",
      secretDigest: digestApiKey(token, pepper),
      scopes: ["runs:create", "runs:read"],
    },
  });
});

console.log(`Seeded local runtime key: ${token}`);
await database.$disconnect();
