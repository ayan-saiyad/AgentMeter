# AgentMeter

AgentMeter is a multi-tenant runtime gateway for autonomous agents. It atomically reserves the maximum cost of each run in Redis, enforces model, tool, duration, token, and concurrency policies, streams provider output, and settles actual usage into an append-only PostgreSQL ledger.

The gateway owns admission and streaming. A worker delivers settlement events, recovers expired leases, reconciles interrupted runs, rebuilds Redis projections from durable records, and maintains analytics rollups. The protected Next.js console shows live runs, budget state, usage, latency, failures, and policy versions.

## Run locally

```bash
cp .env.example .env
npm ci
docker compose up -d postgres redis
npm run db:deploy
npm run db:seed
docker compose up --build
```

The console is available at `http://localhost:3000` and the streaming gateway at `http://localhost:4000`. The seeded runtime key is printed by `npm run db:seed`.

## Kubernetes

The production base is in `deploy/kubernetes/base`. Create `agentmeter-secrets` from `secret.example.yaml`, publish the image referenced by the kustomization, then apply the directory with `kubectl apply -k`. The local overlay also includes single-node PostgreSQL and Redis StatefulSets.
