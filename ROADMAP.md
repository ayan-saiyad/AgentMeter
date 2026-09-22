# AgentMeter phased implementation roadmap

- Status: Ready for review before coding
- Last updated: 2026-09-21
- Rule: A phase is complete only when its exit gate is demonstrated and recorded.

## Delivery strategy

Build one governed run through the full system early, using a deterministic provider simulator. Then harden the same path against concurrency and failure before adding a polished dashboard or a real provider.

The sequence is designed around five proof milestones:

1. **Foundation proof:** the monorepo and local dependencies are reproducible.
2. **Admission proof:** concurrent callers cannot overcommit a tenant budget.
3. **Lifecycle proof:** one simulated stream reserves, runs, settles, and releases capacity end to end.
4. **Recovery proof:** retries, disconnects, process deaths, and store outages converge safely.
5. **Product proof:** operators can see and control the system, and benchmark claims are backed by artifacts.

No benchmark number belongs in project or resume copy until Phase 9 records it with the environment and script that produced it.

## Phase 0 — Architecture and scope contract

**Status:** Complete, pending owner review.

### Outcomes

- Define product boundary and honest claims.
- Establish PostgreSQL as durable truth and Redis as a rebuildable coordination projection.
- Define admission, stream, settlement, lease, outbox, and reconciliation lifecycles.
- Choose a modular monorepo and three production process types: gateway, worker, dashboard.
- Record success criteria without inventing results.

### Deliverables

- `README.md`
- `docs/architecture.md`
- `docs/decisions/0001-postgresql-and-redis-ownership.md`
- This roadmap

### Exit gate

- Owner approves the blueprint or records requested changes.
- No production implementation begins before that review.

---

## Phase 1 — Repository and local platform foundation

### Objective

Create a repeatable TypeScript workspace and a healthy local environment without adding business behavior.

### Work

- Pin a supported LTS runtime baseline (planned: Node.js 24) and package manager.
- Create the workspace layout for gateway, worker, dashboard, simulator, shared packages, Redis Functions, and tests.
- Add strict TypeScript configuration, linting, formatting, unit-test runner, and consistent scripts.
- Add validated environment configuration and a safe `.env.example` with no credentials.
- Add Dockerfiles and Docker Compose for PostgreSQL, Redis, and service development.
- Configure PostgreSQL/Redis health checks, named volumes, graceful service startup, and teardown guidance.
- Add service liveness/readiness skeletons and structured logging.
- Add continuous-integration checks for format, typecheck, unit tests, and container build. Do not create a remote repository unless separately requested.
- Add dependency update and lockfile policy.

### Tests/evidence

- Clean clone/bootstrap command succeeds.
- All workspace packages typecheck.
- Docker Compose becomes healthy from an empty local volume.
- A smoke test reaches PostgreSQL and Redis.
- Gateway and worker stop cleanly on termination signals.

### Exit gate

One documented command starts a reproducible, healthy local stack; one documented command runs all initial checks.

---

## Phase 2 — Domain contracts and PostgreSQL durable plane

### Objective

Make the durable model, state transitions, pricing math, and audit constraints executable before the hot Redis path is added.

### Work

- Define shared runtime request, stream-event, policy, usage, settlement, and error schemas.
- Implement integer-microdollar helpers with overflow/range protection and no floating-point financial math.
- Implement pure state-transition rules and terminal-state invariants.
- Implement conservative cost-bound calculation with versioned price dimensions.
- Create the Prisma schema for tenants, memberships, applications, keys, budgets/periods, policies/versions/bindings, prices, runs, usage events, tool calls, settlements, outbox, admission events, reconciliation cases, and rollups.
- Add migrations, tenant-scoped composite foreign keys, uniqueness checks, non-negative checks, and partial indexes.
- Add targeted SQL protection for append-only usage/settlement evidence.
- Add seed data for one demonstration tenant, application, budget, policy, model price, and redacted API key workflow.
- Implement the finalization transaction and outbox record creation without Redis delivery yet.
- Add repository/query helpers that require tenant context.

### Tests/evidence

- Migration up/down strategy is documented and a clean database migrates successfully.
- Cross-tenant foreign references fail.
- Duplicate idempotency digest and duplicate settlement fail deterministically.
- Append-only records cannot be updated/deleted through the application role.
- Cost property tests cover rounding, zero, upper bounds, and overflow.
- Invalid state transitions fail; valid transitions retain an audit trail.
- Finalization is all-or-nothing under injected database errors.

### Exit gate

The durable schema can prove one run has at most one base settlement, all money is exact integer data, and final usage plus settlement plus outbox commit atomically.

---

## Phase 3 — Redis atomic admission control

### Objective

Prove the central concurrency and budget invariant against a real Redis instance.

### Work

- Define the tenant hash-tagged key builder and document every key/field/retention rule.
- Implement a versioned Redis Function library for reserve, mark-running, renew, cancel, settle, reconciliation hold, and controlled restore.
- Implement typed TypeScript wrappers that validate all inputs/outputs.
- Use Redis server time and fencing tokens for lease ownership.
- Add per-tenant lease sorted sets; do not depend on TTL/keyspace notifications as the scheduler.
- Load the Function library as infrastructure initialization and verify its version in readiness checks.
- Add an administrative check that all cluster primaries have the expected library.
- Define stable rejection codes: budget exhausted, concurrency exhausted, policy rejected, duplicate, projection unavailable.

### Tests/evidence

- Canonical `$10 / twenty $1 attempts` test approves exactly ten reservations.
- At least 200 synchronized admission attempts never violate the budget invariant.
- Repeated and concurrent idempotency keys return one run ID and one reservation.
- Cancellation and settlement replays do not alter balances twice.
- Active-run count cannot go negative.
- All function calls use one tenant hash slot.
- Function runtime remains bounded with no scans/unbounded loops.

### Exit gate

An automated invariant test records zero overcommit violations, zero duplicate reservations, and correct budget/concurrency totals after randomized operation sequences.

---

## Phase 4 — End-to-end streaming gateway walking slice

### Objective

Run one request through authentication, policy, reservation, durable execution claim, simulated provider streaming, settlement, and Redis release.

### Work

- Implement Fastify plugins for configuration, authentication, tenant context, database, Redis, request IDs, redaction, and error mapping.
- Implement `POST /v1/runs` with a required idempotency key and fetch-compatible SSE framing.
- Evaluate the resolved policy and calculate the reservation server-side.
- Reserve in Redis, insert the durable run, compensate on insert failure, and claim provider execution exactly once.
- Implement the provider adapter interface and deterministic simulator adapter.
- Normalize provider events into the shared run event envelope.
- Honor stream backpressure and maximum duration.
- Aggregate usage checkpoints rather than writing per-token rows.
- Implement final PostgreSQL settlement/outbox transaction.
- Add the minimum outbox dispatcher needed to apply Redis settlement and close the walking slice.
- Implement run status and cancellation endpoints.

### Tests/evidence

- Happy-path stream contains ordered accepted/delta/usage/completion events.
- The final database settlement equals simulator usage and Redis releases unused reservation.
- A duplicate request never starts a second simulator execution.
- A database insert failure cancels the Redis reservation.
- A finalization retry returns the existing settlement.
- Slow-client backpressure does not grow memory without bound.

### Exit gate

A scripted demo starts with a known budget, streams one deterministic run, and ends with matching PostgreSQL settlement and Redis budget projection.

---

## Phase 5 — Leases, disconnects, outbox hardening, and reconciliation

### Objective

Make all identified crash windows converge to a safe, observable state.

### Work

- Add lease heartbeat/renewal to active executions.
- Implement the lease sweeper with the durable-evidence decision tree.
- Split orphan release from provider-started reconciliation hold.
- Harden outbox claiming, retry, jittered backoff, dead-letter visibility, and idempotent acknowledgement.
- Implement reconciliation cases, provider usage lookup capability, retry deadlines, and evidence-quality labels.
- Implement client disconnect handling with upstream cancellation and bounded accounting grace.
- Add periodic Redis/PostgreSQL drift audit and an operator-readable diff.
- Implement Redis projection rebuild with admission closed, generation fencing, rehydration, and verification.
- Add named fault barriers to the simulator/gateway/worker for deterministic process termination.
- Write runbooks for stale lease, stuck outbox, unresolved usage, Redis rebuild, and failed settlement.

### Tests/evidence

- Kill after reserve/before DB insert: orphan capacity returns within the lease/sweep bound.
- Kill after execution claim/provider start: funds remain held and reconciliation opens.
- Disconnect before first event, after deltas, during a tool call, before completion, and after provider completion.
- Kill worker before Redis call, after Redis call, and before outbox acknowledgement.
- Stop/restart Redis and rebuild to the PostgreSQL totals before admission reopens.
- Stop PostgreSQL/Redis independently and verify fail-closed behavior.
- Every test run ends terminal or has a visible open reconciliation case.

### Exit gate

The complete fault matrix passes repeatedly with zero unexplained drift and no uncertain provider-started reservation released as free budget.

---

## Phase 6 — Full policy engine, managed tools, and first real provider

### Objective

Expand the verified lifecycle into the runtime-governance product rather than a token proxy.

### Work

- Implement tenant/application/key policy resolution with deny-overrides and most-restrictive numeric ceilings.
- Add policy dry-run/explanation output: matched versions, effective limits, and denial reason.
- Enforce model allow lists, maximum input/output, maximum cost/duration, concurrency, provider retries, and tool counts.
- Implement the managed tool registry, JSON-schema validation, timeouts, size limits, outcome classification, and audit metadata.
- Filter provider-visible tools and reauthorize each emitted tool call before execution.
- Add SSRF/egress protections for any HTTP-based registered tool.
- Select and implement one real provider adapter behind the same simulator-tested interface.
- Add effective-dated pricing and adapter-specific usage normalization.
- Forward the stable run ID as provider idempotency metadata when supported.
- Add external-provider smoke tests that are separate from deterministic CI/load tests.

### Decision checkpoint before the real adapter

- Choose the first provider and credential-storage method.
- Confirm whether prompt/output retention remains disabled (recommended) or receives an explicit policy.
- Confirm whether v1 tool execution is entirely managed or also supports a declared-only compatibility mode.

### Tests/evidence

- Policy precedence table tests cover conflicts and deny-overrides.
- Disallowed model/tool calls fail before provider contact.
- Tool limits are rechecked at runtime, not only at admission.
- Tool arguments/results are absent from default logs and persistence.
- Simulator and real adapter pass one shared contract test suite.
- Price snapshots reproduce each run's cost calculation.

### Exit gate

An operator can define a policy that demonstrably changes admission and runtime tool behavior, while the simulator and first real provider produce the same normalized lifecycle.

---

## Phase 7 — Next.js operational dashboard and administrative API

### Objective

Make control, evidence, and failure states legible to an operator.

### Work

- Implement dashboard authentication/session boundary and tenant role checks.
- Build the admin API for applications, API keys, budgets, policies, run queries, reconciliation, and audit history.
- Build overview cards for available/reserved/settled/overage budget and active concurrency.
- Build Recharts views for spend/usage by time, application, model, and tool.
- Add success/failure/abort/reconciliation and admission-rejection views.
- Add p50/p95/p99 latency, provider errors, settlement delay, lease recovery, and outbox age.
- Build live SSE feed from a capped Redis Stream with bounded replay and reset behavior.
- Build run detail timelines showing policy/price snapshots and accounting evidence.
- Build policy version diff and dry-run interface.
- Build reconciliation/outbox work queues and safe retry actions.
- Add an explicitly labeled, documented budget forecast rather than implying prediction precision.
- Handle empty, loading, stale, disconnected, reset, unauthorized, and server-error states.

### Tests/evidence

- Tenant roles prevent cross-tenant reads/mutations.
- Dashboard values match independent SQL/Redis audit queries.
- Live feed resumes with `Last-Event-ID` and resets cleanly after retention/Redis restart.
- Policy edits create immutable versions and audit events.
- API-key secret is displayed once and never retrievable afterward.
- Responsive/accessibility smoke checks cover key pages and keyboard navigation.

### Exit gate

The full demo can be operated from the UI, and every live number can be traced to its durable or explicitly ephemeral source.

---

## Phase 8 — Security, observability, and operational hardening

### Objective

Turn the working product into an operable system with explicit security and recovery controls.

### Work

- Complete structured-log redaction and content-retention tests.
- Add role-based operator authorization and API-key scope/rotation/revocation.
- Add CSRF/session protections, body/rate limits, security headers, and dependency/container scanning.
- Run containers as non-root with minimal production images and health/readiness probes.
- Add OpenTelemetry traces and bounded-cardinality service metrics.
- Add alerts for budget overage, reconciliation age, lease recovery, drift, outbox age/dead letters, and provider errors.
- Document backup/restore, migration rollback/forward-fix, key rotation, Redis Function deployment, and graceful gateway drain.
- Perform a threat-model review across tenant isolation, credential handling, SSRF, prompt/tool data, and denial of service.
- Test PostgreSQL backup restoration and Redis rebuild from the restored durable state.

### Tests/evidence

- Secret/content canary tests find no leaks in logs, metrics, traces, or dashboard events.
- Revoked credentials stop working within the documented bound.
- Restore drill recreates a consistent system and records recovery steps/timing.
- Graceful shutdown stops new admissions and safely handles/marks active runs.
- Threat-model findings are closed or recorded with an owner and rationale.

### Exit gate

Operational runbooks are executable, sensitive data controls are tested, and alerts correspond to the failure/recovery model.

---

## Phase 9 — Concurrency, fault, and load certification

### Objective

Produce defensible performance and correctness evidence for the project story.

### Work

- Freeze a release candidate and record exact runtime, dependency, container, and host specifications.
- Run invariant suites at increasing concurrency against clean state.
- Run duplicate, disconnect, process-kill, worker-stop, Redis-restart, and database/network fault scenarios repeatedly.
- Use k6 scenarios for admission bursts, sustained reservation throughput, held concurrent streams, dashboard/admin queries, and mixed traffic.
- Use the deterministic stream harness for event-level disconnect timing.
- Record reservation latency, time to first event, stream duration overhead, throughput, error rate, settlement delay, lease recovery, and drift.
- Distinguish service saturation from load-generator saturation.
- Save raw machine-readable results, summarized tables/charts, configuration, and commands.
- Replace resume placeholders only with repeatable results.

### Minimum acceptance suite

- Zero overspend admission violations under at least 200 simultaneous attempts.
- Zero duplicate start claims/settlements in the retry race suite.
- Zero unexplained final drift after reconciliation.
- 100% of never-started abandoned reservations recovered inside the documented bound.
- Every uncertain provider-started run remains held or visible in reconciliation.
- At least 10,000 generated usage records audited with no missing base settlement for terminal billable runs.
- p95 and throughput thresholds chosen from a baseline run, documented, then enforced on the release candidate.

### Exit gate

`docs/benchmark-results.md` links every public number to a reproducible script, environment description, raw artifact, and pass/fail threshold.

---

## Phase 10 — Demonstration and portfolio release

### Objective

Package the engineering work so another developer or interviewer can understand, run, and verify it.

### Work

- Add a one-command local demo with deterministic seed data and simulator scenarios.
- Write architecture, development, testing, security, and operations guides.
- Add a concise demo script that shows normal admission, concurrent rejection, duplicate idempotency, disconnect reconciliation, and dashboard evidence.
- Add diagrams and screenshots generated from the actual product.
- Document known limitations and deferred decisions.
- Create a tagged local release; create/push a remote only with explicit authorization.
- Finalize resume bullets and interview pitch from measured Phase 9 results.

### Exit gate

A fresh environment can run the demo and reproduce the central invariant and at least one recovery scenario using only repository documentation.

## Cross-phase definition of done

Every implementation change must:

- Preserve tenant scope and integer money rules.
- Include tests at the lowest meaningful layer and integration coverage for cross-store behavior.
- Keep network calls outside database transactions.
- Define retry/idempotency behavior for every side effect.
- Add observable failure reasons without logging protected content.
- Update architecture/ADR/runbook documentation when behavior changes.
- Pass format, lint, typecheck, tests, migration checks, and container build.
- Avoid unsupported performance or reliability claims.

## Suggested implementation order inside each coding phase

1. Write the contract/invariant and failing test.
2. Implement the smallest vertical behavior.
3. Add fault and retry behavior.
4. Add observability and operational errors.
5. Run the phase gate and save evidence.
6. Review before expanding scope.

## Scope controls

The following require an explicit architecture decision before entering the active backlog:

- Multi-region or multi-currency budgets
- Arbitrary user-supplied tool URLs or commands
- Prompt/output content retention
- A second real provider
- Kafka or another broker
- Database partitioning
- Customer invoicing/payment flows
- Human-in-the-loop live approvals
- Active-active provider stream handoff between gateway replicas

