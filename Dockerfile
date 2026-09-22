FROM node:24.21.0-bookworm-slim

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

CMD ["npm", "run", "dev:gateway"]
