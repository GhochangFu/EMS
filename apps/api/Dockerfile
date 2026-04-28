FROM node:20-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/shared packages/shared

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @bms/shared build \
  && pnpm --filter @bms/db build \
  && pnpm --filter api build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV="production"
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY --from=build /app /app

WORKDIR /app/apps/api

EXPOSE 4000

CMD ["node", "dist/main.js"]
