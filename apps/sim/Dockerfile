FROM node:20-bookworm-slim AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/sim/package.json apps/sim/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY apps/sim apps/sim
COPY packages/shared packages/shared

RUN pnpm --filter @bms/shared build

ENV NODE_ENV="production"

WORKDIR /app/apps/sim

EXPOSE 9101

CMD ["node", "src/index.js"]
