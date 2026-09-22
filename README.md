# AgentMeter

AgentMeter is an enterprise agent runtime governor. It sits between internal AI applications and model/tool providers to enforce budgets, concurrency limits, model permissions, tool policies, and runtime limits while preserving an auditable usage ledger.

The repository is currently in **architecture planning** and awaits owner review: it contains no application implementation yet.

## Planned stack

- TypeScript on Node.js
- Fastify streaming gateway
- Next.js administrative dashboard and API
- PostgreSQL with Prisma for durable state and the append-only ledger
- Redis Functions for atomic reservations, settlement, leases, concurrency, and idempotency
- Recharts for operational dashboards
- Docker Compose for the local environment
- Vitest, integration/fault harnesses, and k6 for verification

## Planning documents

- [Architecture blueprint](docs/architecture.md)
- [Phased implementation roadmap](ROADMAP.md)
- [ADR 0001: PostgreSQL and Redis ownership](docs/decisions/0001-postgresql-and-redis-ownership.md)

## Core invariant

For every tenant and budget period, AgentMeter must never admit work whose active reservations would cause the budget to be overcommitted:

```text
durable settled spend + active reservations <= configured budget
```

Provider-reported usage that exceeds a correctly computed reservation is treated as an explicit overage incident. It is never hidden by forcing the ledger to match the configured limit.

## Status

1. Architecture and scope: documented
2. Application code: not started
3. Benchmark claims: intentionally unset until measured
