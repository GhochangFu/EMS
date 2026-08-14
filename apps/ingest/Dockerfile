FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/ingest/package.json ./apps/ingest/
COPY packages/shared/package.json ./packages/shared/
# `ingest...` (trailing dots) pulls in workspace dependencies — @bms/shared is
# now one, for the ADR 0016 adapter contracts.
#
# `--ignore-scripts` is load-bearing, and matches `apps/web` and `apps/sim`.
# The root `postinstall` is `pnpm --filter @bms/shared build && pnpm --filter
# @bms/db build`. Its `@bms/db` half no-ops here because that manifest is never
# COPYed — and its `@bms/shared` half used to no-op for the same reason, until
# line 6 above put that manifest in the image. From then on the filter matched,
# `tsc -p tsconfig.build.json` ran against a directory holding nothing but a
# package.json, and the install layer died with TS5058: the image could not be
# built at all. The explicit build on the next RUN owns compilation here, so
# postinstall has nothing left to contribute. Do not remove this flag without
# moving the source COPYs above the install (which costs the dependency layer
# cache).
RUN pnpm install --filter ingest... --frozen-lockfile --ignore-scripts \
  || pnpm install --filter ingest... --ignore-scripts
COPY apps/ingest ./apps/ingest
COPY packages/shared ./packages/shared
# Compile before CMD, so a type error fails the image build rather than the
# running pilot (ADR 0016 §6). Since §6 commit 4 the compile is **required**, not
# defensive: `pnpm start` is `node dist/main.js` and there is no longer a
# JavaScript entry point to fall back to if this step is removed.
RUN pnpm --filter @bms/shared build && pnpm --filter ingest build
WORKDIR /app/apps/ingest
CMD ["pnpm", "start"]
