import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { ServerResponse } from "node:http";
import {
  runRequestSchema,
  serviceVersion,
  type ProviderEvent,
  type RunEvent,
} from "@agentmeter/contracts";
import {
  Prisma,
  claimRun,
  createReservedRun,
  finalizeRun,
  findApiKey,
  type PrismaClient,
} from "@agentmeter/database";
import { loggerOptions } from "@agentmeter/observability";
import {
  computeActualCost,
  computeCostBound,
  evaluatePolicy,
} from "@agentmeter/policy";
import type { ProviderAdapter } from "@agentmeter/providers";
import type { RedisControl } from "@agentmeter/redis-control";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { resolveAdmissionContext } from "./admission.js";

export interface GatewayDependencies {
  apiKeyPepper: string;
  database: PrismaClient;
  leaseRenewMs: number;
  leaseTtlMs: number;
  liveEventRetention: number;
  provider: ProviderAdapter;
  redis: RedisControl;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function tokenFrom(headers: Record<string, unknown>): string | null {
  const authorization = headers.authorization;
  if (
    typeof authorization === "string" &&
    authorization.startsWith("Bearer ")
  ) {
    return authorization.slice(7);
  }
  const apiKey = headers["x-api-key"];
  return typeof apiKey === "string" ? apiKey : null;
}

function idempotencyDigest(tenantId: string, value: string): string {
  return createHash("sha256")
    .update(tenantId)
    .update("\0")
    .update(value)
    .digest("hex");
}

async function writeSse(
  response: ServerResponse,
  event: RunEvent,
): Promise<boolean> {
  if (response.destroyed || response.writableEnded) return false;
  const payload = `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  if (response.write(payload)) return true;
  await Promise.race([once(response, "drain"), once(response, "close")]);
  return !response.destroyed;
}

function serializeRun(run: {
  actualMicrodollars: bigint;
  createdAt: Date;
  id: string;
  inputTokens: number;
  model: string;
  outputTokens: number;
  provider: string;
  reservedMicrodollars: bigint;
  settledAt: Date | null;
  status: string;
  toolCalls: number;
}) {
  return {
    ...run,
    actualMicrodollars: run.actualMicrodollars.toString(),
    reservedMicrodollars: run.reservedMicrodollars.toString(),
  };
}

export function buildGateway(dependencies?: GatewayDependencies) {
  const app = Fastify({ logger: loggerOptions });
  void app.register(cors, { origin: false });
  void app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.get("/health/live", () => ({
    service: "gateway",
    status: "ok" as const,
    version: serviceVersion,
  }));

  app.get("/health/ready", async (_request, reply) => {
    if (!dependencies) return reply.code(503).send({ status: "degraded" });
    try {
      await dependencies.database.$queryRaw`SELECT 1`;
      if (!(await dependencies.redis.ping()))
        throw new Error("Redis ping failed");
      return {
        service: "gateway",
        status: "ok" as const,
        version: serviceVersion,
      };
    } catch (error) {
      app.log.error({ error }, "readiness check failed");
      return reply.code(503).send({
        service: "gateway",
        status: "degraded",
        version: serviceVersion,
      });
    }
  });

  if (dependencies) {
    app.get<{ Params: { runId: string } }>(
      "/v1/runs/:runId",
      async (request) => {
        const token = tokenFrom(request.headers);
        if (!token)
          throw new HttpError(401, "UNAUTHORIZED", "A runtime key is required");
        const key = await findApiKey(
          dependencies.database,
          token,
          dependencies.apiKeyPepper,
        );
        if (!key)
          throw new HttpError(401, "UNAUTHORIZED", "Runtime key is invalid");
        const run = await dependencies.database.agentRun.findFirst({
          where: { id: request.params.runId, tenantId: key.tenantId },
          select: {
            id: true,
            status: true,
            provider: true,
            model: true,
            reservedMicrodollars: true,
            actualMicrodollars: true,
            inputTokens: true,
            outputTokens: true,
            toolCalls: true,
            createdAt: true,
            settledAt: true,
          },
        });
        if (!run)
          throw new HttpError(404, "RUN_NOT_FOUND", "Run was not found");
        return serializeRun(run);
      },
    );

    app.post("/v1/runs", async (request, reply) => {
      const token = tokenFrom(request.headers);
      if (!token)
        throw new HttpError(401, "UNAUTHORIZED", "A runtime key is required");
      const key = await findApiKey(
        dependencies.database,
        token,
        dependencies.apiKeyPepper,
      );
      if (!key)
        throw new HttpError(401, "UNAUTHORIZED", "Runtime key is invalid");

      const idempotencyKey = request.headers["idempotency-key"];
      if (
        typeof idempotencyKey !== "string" ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 200
      ) {
        throw new HttpError(
          400,
          "INVALID_IDEMPOTENCY_KEY",
          "Idempotency-Key must contain 8 to 200 characters",
        );
      }
      const body = runRequestSchema.parse(request.body);
      const digest = idempotencyDigest(key.tenantId, idempotencyKey);
      const context = await resolveAdmissionContext(
        dependencies.database,
        key.tenantId,
        key.applicationId,
        body.model,
      );
      if (!context) {
        await dependencies.database.admissionEvent.create({
          data: {
            tenantId: key.tenantId,
            applicationId: key.applicationId,
            idempotencyDigest: digest,
            decision: "REJECTED",
            reason: "ADMISSION_CONFIGURATION_MISSING",
          },
        });
        throw new HttpError(
          409,
          "ADMISSION_CONFIGURATION_MISSING",
          "No active budget, policy, or price is available",
        );
      }

      const policyDecision = evaluatePolicy(context.policy.rules, body);
      if (!policyDecision.allowed) {
        await dependencies.database.admissionEvent.create({
          data: {
            tenantId: key.tenantId,
            applicationId: key.applicationId,
            idempotencyDigest: digest,
            decision: "REJECTED",
            reason: policyDecision.code,
          },
        });
        throw new HttpError(403, policyDecision.code, policyDecision.detail);
      }

      const estimatedInputTokens = dependencies.provider.estimateInputTokens(
        body.input,
      );
      const reservation = computeCostBound({
        estimatedInputTokens,
        maxOutputTokens: body.maxOutputTokens,
        maxToolCalls: Math.min(
          body.tools.length,
          context.policy.rules.maxToolCalls,
        ),
        price: context.modelPrice.price,
      });
      if (reservation > BigInt(context.policy.rules.maxRunMicrodollars)) {
        await dependencies.database.admissionEvent.create({
          data: {
            tenantId: key.tenantId,
            applicationId: key.applicationId,
            idempotencyDigest: digest,
            decision: "REJECTED",
            reason: "RUN_COST_LIMIT",
            requestedMicrodollars: reservation,
          },
        });
        throw new HttpError(
          403,
          "RUN_COST_LIMIT",
          "Maximum run cost exceeds the policy limit",
        );
      }

      const proposedRunId = randomUUID();
      const owner = `${process.pid}:${randomUUID()}`;
      const reservationResult = await dependencies.redis.reserve({
        amountMicrodollars: reservation,
        budgetPeriodId: context.budgetPeriod.id,
        idempotencyDigest: digest,
        idempotencyTtlMs: 24 * 60 * 60 * 1_000,
        leaseTtlMs: dependencies.leaseTtlMs,
        owner,
        runId: proposedRunId,
        tenantId: key.tenantId,
      });

      if (reservationResult.decision === "REJECTED") {
        await dependencies.database.admissionEvent.create({
          data: {
            tenantId: key.tenantId,
            applicationId: key.applicationId,
            idempotencyDigest: digest,
            decision: "REJECTED",
            reason: reservationResult.reason ?? "ADMISSION_REJECTED",
            requestedMicrodollars: reservation,
          },
        });
        return reply.code(429).send({
          code: reservationResult.reason ?? "ADMISSION_REJECTED",
          runId: reservationResult.runId,
        });
      }

      if (!reservationResult.created) {
        const existing = await dependencies.database.agentRun.findFirst({
          where: {
            tenantId: key.tenantId,
            id: reservationResult.runId,
          },
          select: { id: true, status: true },
        });
        return reply.code(existing ? 200 : 202).send({
          duplicate: true,
          runId: reservationResult.runId,
          status: existing?.status ?? reservationResult.status,
        });
      }

      try {
        await dependencies.database.$transaction(async (transaction) => {
          await createReservedRun(transaction, {
            id: reservationResult.runId,
            tenantId: key.tenantId,
            applicationId: key.applicationId,
            budgetPeriodId: context.budgetPeriod.id,
            idempotencyDigest: digest,
            maxDurationMs: body.maxDurationMs,
            maxOutputTokens: body.maxOutputTokens,
            model: body.model,
            modelPriceId: context.modelPrice.id,
            policySnapshot: context.policy.rules,
            policyVersionId: context.policy.id,
            priceSnapshot: context.modelPrice.price,
            provider: "simulator",
            ...(body.metadata ? { requestMetadata: body.metadata } : {}),
            reservedMicrodollars: reservation,
          });
          await transaction.admissionEvent.create({
            data: {
              tenantId: key.tenantId,
              applicationId: key.applicationId,
              runId: reservationResult.runId,
              idempotencyDigest: digest,
              decision: "ACCEPTED",
              reason: "ACCEPTED",
              requestedMicrodollars: reservation,
            },
          });
        });
      } catch (error) {
        await dependencies.redis.cancel(
          key.tenantId,
          context.budgetPeriod.id,
          reservationResult.runId,
          "DURABLE_INSERT_FAILED",
        );
        throw error;
      }

      const claimed = await claimRun(
        dependencies.database,
        reservationResult.runId,
        owner,
      );
      if (!claimed) {
        throw new HttpError(
          409,
          "EXECUTION_ALREADY_CLAIMED",
          "Another gateway owns this run",
        );
      }
      const running = await dependencies.redis.markRunning(
        key.tenantId,
        reservationResult.runId,
        owner,
        dependencies.leaseTtlMs,
      );
      if (!new Set(["RUNNING", "ALREADY_RUNNING"]).has(running[0] ?? "")) {
        await dependencies.redis.cancel(
          key.tenantId,
          context.budgetPeriod.id,
          reservationResult.runId,
          "START_FENCE_FAILED",
        );
        await dependencies.database.agentRun.update({
          where: { id: reservationResult.runId },
          data: { failureCode: "START_FENCE_FAILED", status: "CANCELLED" },
        });
        throw new HttpError(
          503,
          "START_FENCE_FAILED",
          "Run could not acquire an execution fence",
        );
      }
      await dependencies.database.agentRun.update({
        where: { id: reservationResult.runId },
        data: { providerStartedAt: new Date() },
      });

      reply.hijack();
      reply.raw.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      });

      const controller = new AbortController();
      let clientDisconnected = false;
      let sequence = 0;
      let finalUsage: Extract<ProviderEvent, { type: "usage.final" }> | null =
        null;
      const onClose = () => {
        if (!reply.raw.writableEnded) {
          clientDisconnected = true;
          controller.abort(new Error("CLIENT_DISCONNECTED"));
        }
      };
      reply.raw.on("close", onClose);
      const deadline = setTimeout(
        () => controller.abort(new Error("RUN_DEADLINE_EXCEEDED")),
        body.maxDurationMs,
      );
      const renewal = setInterval(() => {
        void dependencies.redis
          .renewLease(
            key.tenantId,
            reservationResult.runId,
            owner,
            reservationResult.fence ?? 1,
            dependencies.leaseTtlMs,
          )
          .catch((error: unknown) =>
            app.log.error(
              { error, runId: reservationResult.runId },
              "lease renewal failed",
            ),
          );
      }, dependencies.leaseRenewMs);

      const emit = async (
        type: string,
        data: Record<string, unknown>,
      ): Promise<void> => {
        sequence += 1;
        const event: RunEvent = {
          data,
          runId: reservationResult.runId,
          sequence,
          timestamp: new Date().toISOString(),
          type,
          version: 1,
        };
        await writeSse(reply.raw, event);
        void dependencies.redis
          .appendLiveEvent(key.tenantId, dependencies.liveEventRetention, {
            data: JSON.stringify(event.data),
            runId: event.runId,
            sequence: String(event.sequence),
            timestamp: event.timestamp,
            type: event.type,
          })
          .catch((error: unknown) =>
            app.log.warn(
              { error, runId: event.runId },
              "live event append failed",
            ),
          );
      };

      try {
        await emit("run.accepted", {
          reservedMicrodollars: reservation.toString(),
        });
        for await (const event of dependencies.provider.stream(
          { ...body, runId: reservationResult.runId },
          controller.signal,
        )) {
          if (event.type === "message.delta") {
            await emit(event.type, { text: event.text });
          } else if (event.type === "usage.final") {
            finalUsage = event;
            await emit("usage.checkpoint", {
              cachedTokens: event.cachedTokens,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              toolCalls: event.toolCalls,
            });
          } else if (event.type === "provider.completed") {
            await dependencies.database.agentRun.update({
              where: { id: reservationResult.runId },
              data: { providerRequestId: event.providerRequestId },
            });
          } else {
            throw new Error(
              `Tool call ${event.name} requires managed execution`,
            );
          }
        }
        if (!finalUsage) throw new Error("FINAL_USAGE_UNAVAILABLE");

        const actual = computeActualCost({
          cachedTokens: finalUsage.cachedTokens,
          inputTokens: finalUsage.inputTokens,
          outputTokens: finalUsage.outputTokens,
          price: context.modelPrice.price,
          toolCalls: finalUsage.toolCalls,
        });
        const settlement = await finalizeRun(
          dependencies.database,
          reservationResult.runId,
          {
            actualMicrodollars: actual,
            cachedTokens: finalUsage.cachedTokens,
            evidence: "PROVIDER_FINAL",
            inputTokens: finalUsage.inputTokens,
            outputTokens: finalUsage.outputTokens,
            sequence,
            toolCalls: finalUsage.toolCalls,
          },
        );
        await emit("run.completed", {
          actualMicrodollars: actual.toString(),
          settlementId: settlement.id,
        });
      } catch (error) {
        const code =
          controller.signal.reason instanceof Error
            ? controller.signal.reason.message
            : error instanceof Error
              ? error.message
              : "RUN_FAILED";
        await dependencies.database.$transaction(async (transaction) => {
          await transaction.agentRun.update({
            where: { id: reservationResult.runId },
            data: {
              clientDisconnectedAt: clientDisconnected ? new Date() : null,
              failureCode: code,
              status: "RECONCILING",
            },
          });
          await transaction.reconciliationCase.upsert({
            where: { runId: reservationResult.runId },
            update: { reason: code, status: "OPEN" },
            create: {
              tenantId: key.tenantId,
              runId: reservationResult.runId,
              reason: code,
              deadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
            },
          });
        });
        await dependencies.redis.hold(
          key.tenantId,
          reservationResult.runId,
          code,
        );
        if (!clientDisconnected) await emit("run.failed", { code });
      } finally {
        clearInterval(renewal);
        clearTimeout(deadline);
        reply.raw.off("close", onClose);
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
      }
      return reply;
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "Request validation failed",
        issues: error.issues,
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return reply.code(409).send({
        code: "CONFLICT",
        message: "A unique resource already exists",
      });
    }
    app.log.error({ error }, "request failed");
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      message: "The request could not be completed",
    });
  });

  return app;
}
