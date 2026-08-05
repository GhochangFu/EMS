FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/ingest/package.json ./apps/ingest/
COPY packages/shared/package.json ./packages/shared/
# `ingest...` (trailing dots) pulls in workspace dependencies — @bms/shared is
# now one, for the ADR 0016 adapter contracts.
RUN pnpm install --filter ingest... --frozen-lockfile || pnpm install --filter ingest...
COPY apps/ingest ./apps/ingest
COPY packages/shared ./packages/shared
# Compile before CMD, so a type error fails the image build rather than the
# running pilot (ADR 0016 §6). `pnpm start` is deliberately unchanged and still
# runs the legacy `src/index.js`; the strangler cutover is a later commit.
RUN pnpm --filter @bms/shared build && pnpm --filter ingest build
WORKDIR /app/apps/ingest
CMD ["pnpm", "start"]
