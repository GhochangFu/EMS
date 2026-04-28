FROM node:20-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

ARG VITE_API_URL=http://localhost:4000
ARG VITE_WS_URL=ws://localhost:4000
ARG VITE_AUTH_MODE=local
ARG VITE_OIDC_ISSUER=
ARG VITE_OIDC_CLIENT_ID=
ARG VITE_OIDC_REDIRECT_URI=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE
ENV VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER
ENV VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
ENV VITE_OIDC_REDIRECT_URI=$VITE_OIDC_REDIRECT_URI

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY apps/web apps/web
COPY packages/shared packages/shared

RUN pnpm --filter @bms/shared build \
  && pnpm --filter web build

FROM nginx:1.27-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
