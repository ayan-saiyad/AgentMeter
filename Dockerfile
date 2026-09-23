FROM node:24.21.0-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/provider-simulator/package.json apps/provider-simulator/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/policy/package.json packages/policy/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/redis-control/package.json packages/redis-control/package.json

RUN npm ci

COPY . .

RUN npm run db:generate

RUN DATABASE_URL=postgresql://build:build@localhost:5432/build REDIS_URL=redis://localhost:6379 ADMIN_TOKEN=build-only-token-with-at-least-32-characters npm run build --workspace @agentmeter/dashboard \
  && cp -R apps/dashboard/.next/static apps/dashboard/.next/standalone/apps/dashboard/.next/static

FROM base AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app /app

USER node

CMD ["npm", "run", "start", "--workspace", "@agentmeter/gateway"]
