FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/ingest/package.json ./apps/ingest/
RUN pnpm install --filter ingest --frozen-lockfile || pnpm install --filter ingest
COPY apps/ingest ./apps/ingest
WORKDIR /app/apps/ingest
CMD ["pnpm", "start"]
