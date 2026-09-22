import { policyRulesSchema } from "@agentmeter/contracts";
import { database, Prisma } from "@agentmeter/database";
import { NextResponse } from "next/server";
import { isAdmin } from "../../../../lib/auth";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ bindingId: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }
  const payload: unknown = await request.json();
  const rules = policyRulesSchema.parse(
    typeof payload === "object" && payload !== null && "rules" in payload
      ? payload.rules
      : undefined,
  );
  const { bindingId } = await context.params;
  const binding = await database.policyBinding.findUnique({
    where: { id: bindingId },
    include: { policy: true },
  });
  if (!binding) {
    return NextResponse.json({ code: "POLICY_NOT_FOUND" }, { status: 404 });
  }
  const version = await database.$transaction(
    async (transaction) => {
      const latest = await transaction.policyVersion.aggregate({
        where: { tenantId: binding.tenantId, policyId: binding.policyId },
        _max: { version: true },
      });
      const created = await transaction.policyVersion.create({
        data: {
          tenantId: binding.tenantId,
          policyId: binding.policyId,
          rules,
          version: (latest._max.version ?? 0) + 1,
        },
      });
      await transaction.policyBinding.update({
        where: { id: binding.id },
        data: { policyVersionId: created.id },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: binding.tenantId,
          actorType: "ADMIN_SESSION",
          actorId: "dashboard",
          action: "policy.updated",
          resourceType: "policy",
          resourceId: binding.policyId,
          details: { version: created.version },
        },
      });
      return created.version;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return NextResponse.json({ rules, version });
}
