import {
  modelPriceSchema,
  policyRulesSchema,
  type ModelPrice,
  type PolicyRules,
} from "@agentmeter/contracts";
import type { PrismaClient } from "@agentmeter/database";

export interface AdmissionContext {
  budgetPeriod: {
    id: string;
    limitMicrodollars: bigint;
  };
  modelPrice: {
    id: string;
    price: ModelPrice;
  };
  policy: {
    id: string;
    rules: PolicyRules;
  };
}

export async function resolveAdmissionContext(
  database: PrismaClient,
  tenantId: string,
  applicationId: string,
  model: string,
): Promise<AdmissionContext | null> {
  const now = new Date();
  const [bindings, budgets, price] = await Promise.all([
    database.policyBinding.findMany({
      where: {
        tenantId,
        enabled: true,
        OR: [
          { targetType: "APPLICATION", targetId: applicationId },
          { targetType: "TENANT", targetId: null },
        ],
      },
      include: { policyVersion: true },
      orderBy: { priority: "desc" },
    }),
    database.budget.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        OR: [{ applicationId }, { applicationId: null }],
      },
      include: {
        periods: {
          where: { startsAt: { lte: now }, endsAt: { gt: now } },
          take: 1,
        },
      },
    }),
    database.modelPrice.findFirst({
      where: {
        tenantId,
        provider: "simulator",
        model,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    }),
  ]);

  const binding = bindings[0];
  const budget =
    budgets.find((candidate) => candidate.applicationId === applicationId) ??
    budgets.find((candidate) => candidate.applicationId === null);
  const period = budget?.periods[0];
  if (!binding || !period || !price) return null;

  return {
    budgetPeriod: {
      id: period.id,
      limitMicrodollars: period.limitMicrodollars,
    },
    modelPrice: {
      id: price.id,
      price: modelPriceSchema.parse({
        cachedPerMillionMicrodollars:
          price.cachedPerMillionMicrodollars.toString(),
        inputPerMillionMicrodollars:
          price.inputPerMillionMicrodollars.toString(),
        outputPerMillionMicrodollars:
          price.outputPerMillionMicrodollars.toString(),
        toolCallMicrodollars: price.toolCallMicrodollars.toString(),
      }),
    },
    policy: {
      id: binding.policyVersionId,
      rules: policyRulesSchema.parse(binding.policyVersion.rules),
    },
  };
}
