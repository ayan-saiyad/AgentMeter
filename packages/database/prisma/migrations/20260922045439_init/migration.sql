-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RESERVED', 'RUNNING', 'ABORTED', 'FAILED', 'EXPIRED', 'RECONCILING', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdmissionDecision" AS ENUM ('ACCEPTED', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "UsageEventType" AS ENUM ('CHECKPOINT', 'PROVIDER_FINAL', 'TOOL', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "SettlementEvidence" AS ENUM ('PROVIDER_FINAL', 'RECONCILED', 'CONSERVATIVE_ESTIMATE');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('OPEN', 'RETRYING', 'RESOLVED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ToolDecision" AS ENUM ('ALLOWED', 'DENIED');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_membership" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "tenant_membership_pkey" PRIMARY KEY ("tenant_id","user_id")
);

-- CreateTable
CREATE TABLE "application" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secret_digest" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "BudgetStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_period" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "limit_microdollars" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_binding" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_version_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_price" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_per_million_microdollars" BIGINT NOT NULL,
    "output_per_million_microdollars" BIGINT NOT NULL,
    "cached_per_million_microdollars" BIGINT NOT NULL DEFAULT 0,
    "tool_call_microdollars" BIGINT NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "budget_period_id" UUID NOT NULL,
    "policy_version_id" UUID,
    "model_price_id" UUID,
    "idempotency_digest" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RESERVED',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "max_output_tokens" INTEGER NOT NULL,
    "max_duration_ms" INTEGER NOT NULL,
    "reserved_microdollars" BIGINT NOT NULL,
    "actual_microdollars" BIGINT NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "policy_snapshot" JSONB NOT NULL,
    "price_snapshot" JSONB NOT NULL,
    "request_metadata" JSONB,
    "execution_owner" TEXT,
    "provider_request_id" TEXT,
    "execution_claimed_at" TIMESTAMP(3),
    "provider_started_at" TIMESTAMP(3),
    "client_disconnected_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_event" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "UsageEventType" NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "cost_microdollars" BIGINT NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_invocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "tool_name" TEXT NOT NULL,
    "decision" "ToolDecision" NOT NULL,
    "arguments_digest" TEXT,
    "outcome" TEXT,
    "duration_ms" INTEGER,
    "cost_microdollars" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "tool_invocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "reserved_microdollars" BIGINT NOT NULL,
    "actual_microdollars" BIGINT NOT NULL,
    "unused_microdollars" BIGINT NOT NULL,
    "evidence" "SettlementEvidence" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_adjustment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "evidence_key" TEXT NOT NULL,
    "delta_microdollars" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "run_id" UUID,
    "idempotency_digest" TEXT NOT NULL,
    "decision" "AdmissionDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_microdollars" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_case" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,
    "resolution" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "reconciliation_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_usage_rollup" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "aborted_count" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "tool_calls" BIGINT NOT NULL DEFAULT 0,
    "cost_microdollars" BIGINT NOT NULL DEFAULT 0,
    "p50_latency_ms" INTEGER,
    "p95_latency_ms" INTEGER,
    "p99_latency_ms" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_usage_rollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "application_tenant_id_enabled_idx" ON "application"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "application_tenant_id_slug_key" ON "application"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "application_tenant_id_id_key" ON "application"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_secret_digest_key" ON "api_key"("secret_digest");

-- CreateIndex
CREATE INDEX "api_key_tenant_id_application_id_status_idx" ON "api_key"("tenant_id", "application_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_tenant_id_prefix_key" ON "api_key"("tenant_id", "prefix");

-- CreateIndex
CREATE INDEX "budget_tenant_id_status_idx" ON "budget"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "budget_tenant_id_name_key" ON "budget"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "budget_tenant_id_id_key" ON "budget"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "budget_period_tenant_id_starts_at_ends_at_idx" ON "budget_period"("tenant_id", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "budget_period_tenant_id_budget_id_starts_at_key" ON "budget_period"("tenant_id", "budget_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "budget_period_tenant_id_id_key" ON "budget_period"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_tenant_id_name_key" ON "policy"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "policy_tenant_id_id_key" ON "policy"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_version_tenant_id_policy_id_version_key" ON "policy_version"("tenant_id", "policy_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "policy_version_tenant_id_id_key" ON "policy_version"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "policy_binding_tenant_id_target_type_target_id_enabled_prio_idx" ON "policy_binding"("tenant_id", "target_type", "target_id", "enabled", "priority");

-- CreateIndex
CREATE INDEX "model_price_tenant_id_provider_model_effective_from_idx" ON "model_price"("tenant_id", "provider", "model", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "model_price_tenant_id_provider_model_effective_from_key" ON "model_price"("tenant_id", "provider", "model", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "model_price_tenant_id_id_key" ON "model_price"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "agent_run_tenant_id_status_created_at_idx" ON "agent_run"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "agent_run_tenant_id_application_id_created_at_idx" ON "agent_run"("tenant_id", "application_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_tenant_id_idempotency_digest_key" ON "agent_run"("tenant_id", "idempotency_digest");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_tenant_id_id_key" ON "agent_run"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "usage_event_tenant_id_occurred_at_idx" ON "usage_event"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "usage_event_tenant_id_run_id_occurred_at_idx" ON "usage_event"("tenant_id", "run_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "usage_event_run_id_sequence_key" ON "usage_event"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "tool_invocation_tenant_id_tool_name_created_at_idx" ON "tool_invocation"("tenant_id", "tool_name", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tool_invocation_run_id_sequence_key" ON "tool_invocation"("run_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_run_id_key" ON "settlement"("run_id");

-- CreateIndex
CREATE INDEX "settlement_tenant_id_created_at_idx" ON "settlement"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_tenant_id_run_id_key" ON "settlement"("tenant_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_tenant_id_id_key" ON "settlement"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "settlement_adjustment_tenant_id_settlement_id_idx" ON "settlement_adjustment"("tenant_id", "settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_adjustment_tenant_id_evidence_key_key" ON "settlement_adjustment"("tenant_id", "evidence_key");

-- CreateIndex
CREATE INDEX "outbox_event_status_next_attempt_at_created_at_idx" ON "outbox_event"("status", "next_attempt_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_event_tenant_id_created_at_idx" ON "outbox_event"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_event_event_type_dedupe_key_key" ON "outbox_event"("event_type", "dedupe_key");

-- CreateIndex
CREATE INDEX "admission_event_tenant_id_created_at_idx" ON "admission_event"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "admission_event_tenant_id_decision_reason_created_at_idx" ON "admission_event"("tenant_id", "decision", "reason", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_case_run_id_key" ON "reconciliation_case"("run_id");

-- CreateIndex
CREATE INDEX "reconciliation_case_tenant_id_status_next_attempt_at_idx" ON "reconciliation_case"("tenant_id", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_case_tenant_id_run_id_key" ON "reconciliation_case"("tenant_id", "run_id");

-- CreateIndex
CREATE INDEX "daily_usage_rollup_tenant_id_day_idx" ON "daily_usage_rollup"("tenant_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "daily_usage_rollup_tenant_id_application_id_day_provider_mo_key" ON "daily_usage_rollup"("tenant_id", "application_id", "day", "provider", "model");

-- CreateIndex
CREATE INDEX "audit_event_tenant_id_created_at_idx" ON "audit_event"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_tenant_id_application_id_fkey" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "application"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_tenant_id_application_id_fkey" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "application"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_period" ADD CONSTRAINT "budget_period_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_period" ADD CONSTRAINT "budget_period_tenant_id_budget_id_fkey" FOREIGN KEY ("tenant_id", "budget_id") REFERENCES "budget"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy" ADD CONSTRAINT "policy_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_tenant_id_policy_id_fkey" FOREIGN KEY ("tenant_id", "policy_id") REFERENCES "policy"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_binding" ADD CONSTRAINT "policy_binding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_binding" ADD CONSTRAINT "policy_binding_tenant_id_policy_id_fkey" FOREIGN KEY ("tenant_id", "policy_id") REFERENCES "policy"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_binding" ADD CONSTRAINT "policy_binding_tenant_id_policy_version_id_fkey" FOREIGN KEY ("tenant_id", "policy_version_id") REFERENCES "policy_version"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_price" ADD CONSTRAINT "model_price_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_tenant_id_application_id_fkey" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "application"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_tenant_id_budget_period_id_fkey" FOREIGN KEY ("tenant_id", "budget_period_id") REFERENCES "budget_period"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_tenant_id_policy_version_id_fkey" FOREIGN KEY ("tenant_id", "policy_version_id") REFERENCES "policy_version"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_tenant_id_model_price_id_fkey" FOREIGN KEY ("tenant_id", "model_price_id") REFERENCES "model_price"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "agent_run"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocation" ADD CONSTRAINT "tool_invocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocation" ADD CONSTRAINT "tool_invocation_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "agent_run"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "agent_run"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustment" ADD CONSTRAINT "settlement_adjustment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_adjustment" ADD CONSTRAINT "settlement_adjustment_tenant_id_settlement_id_fkey" FOREIGN KEY ("tenant_id", "settlement_id") REFERENCES "settlement"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_event" ADD CONSTRAINT "admission_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_event" ADD CONSTRAINT "admission_event_tenant_id_application_id_fkey" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "application"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_event" ADD CONSTRAINT "admission_event_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "agent_run"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_case" ADD CONSTRAINT "reconciliation_case_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_case" ADD CONSTRAINT "reconciliation_case_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "agent_run"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_usage_rollup" ADD CONSTRAINT "daily_usage_rollup_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_usage_rollup" ADD CONSTRAINT "daily_usage_rollup_tenant_id_application_id_fkey" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "application"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exact accounting and lifecycle guards
ALTER TABLE "budget_period"
  ADD CONSTRAINT "budget_period_limit_nonnegative" CHECK ("limit_microdollars" >= 0),
  ADD CONSTRAINT "budget_period_range_valid" CHECK ("ends_at" > "starts_at");

ALTER TABLE "model_price"
  ADD CONSTRAINT "model_price_nonnegative" CHECK (
    "input_per_million_microdollars" >= 0 AND
    "output_per_million_microdollars" >= 0 AND
    "cached_per_million_microdollars" >= 0 AND
    "tool_call_microdollars" >= 0
  );

ALTER TABLE "agent_run"
  ADD CONSTRAINT "agent_run_amounts_nonnegative" CHECK (
    "reserved_microdollars" >= 0 AND "actual_microdollars" >= 0
  ),
  ADD CONSTRAINT "agent_run_counts_nonnegative" CHECK (
    "max_output_tokens" > 0 AND "max_duration_ms" > 0 AND
    "input_tokens" >= 0 AND "output_tokens" >= 0 AND "tool_calls" >= 0
  );

ALTER TABLE "usage_event"
  ADD CONSTRAINT "usage_event_values_nonnegative" CHECK (
    "sequence" >= 0 AND "input_tokens" >= 0 AND "output_tokens" >= 0 AND
    "cached_tokens" >= 0 AND "tool_calls" >= 0 AND "cost_microdollars" >= 0
  );

ALTER TABLE "tool_invocation"
  ADD CONSTRAINT "tool_invocation_values_nonnegative" CHECK (
    "sequence" >= 0 AND "cost_microdollars" >= 0 AND
    ("duration_ms" IS NULL OR "duration_ms" >= 0)
  );

ALTER TABLE "settlement"
  ADD CONSTRAINT "settlement_values_valid" CHECK (
    "reserved_microdollars" >= 0 AND "actual_microdollars" >= 0 AND
    "unused_microdollars" = GREATEST("reserved_microdollars" - "actual_microdollars", 0)
  );

ALTER TABLE "admission_event"
  ADD CONSTRAINT "admission_requested_nonnegative" CHECK ("requested_microdollars" >= 0);

-- Durable evidence is append-only. Corrections use new adjustment rows.
CREATE FUNCTION reject_immutable_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER usage_event_append_only
  BEFORE UPDATE OR DELETE ON "usage_event"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER settlement_append_only
  BEFORE UPDATE OR DELETE ON "settlement"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER settlement_adjustment_append_only
  BEFORE UPDATE OR DELETE ON "settlement_adjustment"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
