# ADR 0001: PostgreSQL and Redis ownership

- Status: Accepted for implementation
- Date: 2026-09-21

## Context

AgentMeter must make low-latency admission decisions across concurrent gateway instances and must also retain a durable, auditable account of every run and charge. No distributed transaction spans Redis and PostgreSQL, so the system needs an explicit ownership and recovery model.

## Decision

PostgreSQL is the durable source of truth for tenants, applications, policies, runs, usage events, settlements, reconciliation cases, and the outbox.

Redis is a conservative real-time projection used for atomic admission control. Redis owns the immediate decision to reserve, renew, cancel, or settle capacity, but its state must be reconstructable from PostgreSQL.

The cross-store workflow is deliberately asymmetric:

1. Admission reserves capacity atomically in Redis.
2. The gateway records the approved run in PostgreSQL before any provider execution starts.
3. If that insert fails, the gateway calls an idempotent Redis cancellation function. The lease sweeper recovers the reservation if the gateway dies first.
4. Final usage, the settlement, the run transition, and an outbox event commit together in one PostgreSQL transaction.
5. An at-least-once worker applies the outbox event through an idempotent Redis settlement function.
6. Redis rejects new admissions while its projection is being rebuilt after state loss.

## Consequences

- A delayed settlement worker can temporarily reduce availability, but cannot admit overspending.
- Redis loss affects availability, not the durable ledger.
- PostgreSQL loss prevents new provider executions; approved-but-unrecorded Redis reservations are cancelled or expire.
- Every cross-store operation needs an idempotency identifier and a compensating or reconciliation path.
- Recovery and drift checking are product features, not operational afterthoughts.

## Alternatives rejected

### PostgreSQL-only locking

Row locks or serializable transactions could enforce budgets, but long-lived/high-volume admission traffic would couple gateway latency and contention to the durable ledger. PostgreSQL remains authoritative, but Redis handles the hot coordination path.

### Redis as the ledger

Redis persistence is valuable, but it is not the desired system of record for relational audit queries, long-term usage history, and transactional settlement plus outbox writes.

### Best-effort dual writes

Writing both stores without an outbox and idempotent compensation creates unrecoverable ambiguity when a process fails between writes.

