FROM node:20-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

# Root `postinstall` ends in `node .githooks/install.mjs` since 377e8f9 (#159),
# and this image never COPYed that directory — so `pnpm install` below died with
# `Cannot find module '/app/.githooks/install.mjs'` and the API image could not
# be built at all. Pre-existing on main, not from a feature branch.
#
# Why a COPY and not `--ignore-scripts`, which web/sim/ingest all pass: those
# three install BEFORE COPYing sources, so postinstall's *build* half is what
# breaks there (tsc against a directory holding only a package.json — see the
# TS5058 note in apps/ingest/Dockerfile). This image COPYs sources first, so the
# build half works and only the hook segment fails. Passing `--ignore-scripts`
# here would also skip **dependency** install scripts, and `bcrypt@5.1.1` fetches
# its native binding through `node-pre-gyp install`: the image would then build
# green and crash on first `require('bcrypt')`. A silent runtime break is worse
# than the loud build break this replaces.
#
# install.mjs is already written for this case — it exits 0 when there is no git
# checkout, which is every Docker build context. Nothing is installed here; the
# COPY exists so the path resolves.
COPY .githooks .githooks

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
