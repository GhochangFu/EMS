# Environment Inventory

Phase 1 keeps the prototype variables and adds compose defaults for
reproducible development. Real secrets still belong in uncommitted `.env`
files or deployment secret stores.

## API

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `DATABASE_URL` | Yes | `postgres://bms_app:bms_app_dev@postgres:5432/bms` | Postgres/TimescaleDB connection string. |
| `JWT_SECRET` | Local auth only | `change-me-in-compose` | Local JWT signing secret for native WSL fallback and non-OIDC smoke checks. |
| `JWT_TTL` | Local auth only | `8h` | Local JWT lifetime. |
| `AUTH_MODE` | No | `oidc` in compose, `local` in native `.env.example` | Selects local JWT auth or Keycloak/OIDC bearer-token validation. |
| `OIDC_ISSUER` | OIDC only | `http://localhost:8080/realms/bms` | Expected issuer claim for Keycloak tokens. |
| `OIDC_JWKS_URI` | OIDC only | `http://keycloak:8080/realms/bms/protocol/openid-connect/certs` | API-internal URL used to fetch the Keycloak signing keys. |
| `OIDC_AUDIENCE` | No | unset | Optional audience check for access tokens. |
| `OTEL_SERVICE_NAME` | No | `bms-api` in compose | Service name attached to OpenTelemetry spans and Prometheus default labels. |
| `OTEL_SDK_DISABLED` | No | unset | Set to `true` to disable API OpenTelemetry SDK startup. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | unset | Optional OTLP HTTP collector base URL. When unset, tracing instrumentation starts without export. |
| `PORT` | No | `4000` | API HTTP and Socket.IO port. |
| `LOG_LEVEL` | No | `info` | Pino log level. |
| `ENERGY_TARIFF_ZAR_PER_KWH` | No | `2.15` | Indicative Energy Centre cost calculation. |
| `REDIS_URL` | No | `redis://redis:6379` in compose | Enables Socket.IO Redis fan-out. Native WSL may omit it for in-process fallback. |

## Web

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `VITE_API_URL` | Yes | `http://localhost:4000` | Browser-facing API base URL baked into the Vite build. |
| `VITE_WS_URL` | Yes | `ws://localhost:4000` | Browser-facing Socket.IO base URL baked into the Vite build. |
| `VITE_AUTH_MODE` | No | `oidc` in compose, `local` in native `.env.example` | Selects Keycloak login or the native local login form. |
| `VITE_OIDC_ISSUER` | OIDC only | `http://localhost:8080/realms/bms` | Browser-facing Keycloak realm URL. |
| `VITE_OIDC_CLIENT_ID` | OIDC only | `bms-web` | Public OIDC client configured in the realm export. |
| `VITE_OIDC_REDIRECT_URI` | OIDC only | `http://localhost:5173/auth/callback` | SPA callback URL registered in Keycloak. |

## Keycloak Container

The committed development realm sets an 8-hour access token and SSO
session lifetime so protected prototype screens do not force frequent
re-login during demos.

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `KEYCLOAK_ADMIN` | Yes | `admin` | Local Keycloak admin username. |
| `KEYCLOAK_ADMIN_PASSWORD` | Yes | `admin` | Local Keycloak admin password. Development only. |
| `KC_HOSTNAME_STRICT` | No | `false` | Allows localhost browser access during development. |
| `KC_HTTP_ENABLED` | No | `true` | Enables HTTP for local compose development. |

## Simulator

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `DATABASE_URL` | Yes | `postgres://bms_app:bms_app_dev@postgres:5432/bms` | Postgres/TimescaleDB connection string. |
| `SIM_RATE_HZ` | No | `0.2` in compose | Simulator write frequency. |
| `SIM_ASSET_COUNT` | No | `all` in Compose | Maximum seeded assets loaded by the simulator; use `all` for full coverage or a number to cap rows ordered by asset code. |
| `SIM_SITE_NAMES` | No | `RSMOC Western Cape,SMOC Pretoria North,RSMOC KwaZulu-Natal` in compose | Optional comma-separated seeded site names to limit simulator telemetry to selected demo locations. |
| `SIM_METRICS_PORT` | No | `9101` | Prometheus metrics HTTP port exposed by the simulator. |

## Observability Containers

These services run only with the `observability` compose profile.

| Service | Port | Purpose |
|---------|------|---------|
| `prometheus` | `9090` | Scrapes API `/metrics`, simulator `/metrics`, and Prometheus self-metrics. |
| `grafana` | `3000` | Dashboard UI. Local admin credentials are `admin` / `admin`. |
| `loki` | `3100` | Local log storage. |
| `promtail` | none | Collects Docker container logs and ships them to Loki. |

## Database Container

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `POSTGRES_DB` | Yes | `bms` | Database name created by the TimescaleDB image. |
| `POSTGRES_USER` | Yes | `bms_app` | Application database role. |
| `POSTGRES_PASSWORD` | Yes | `bms_app_dev` | Local development password only. |
