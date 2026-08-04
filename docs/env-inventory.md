# Environment Inventory

Phase 1 keeps the prototype variables and adds compose defaults for
reproducible development. Real secrets still belong in uncommitted `.env`
files or deployment secret stores.

Variables marked **Secret** below must come from a secret store in any
non-local deployment, must never be committed, and must never be baked into an
image layer. See
[`security/encryption-at-rest.md`](./security/encryption-at-rest.md) for key
handling, image-layer rules, and the host-level configuration a deployer must
provide.

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
| `CREDENTIAL_ENCRYPTION_KEY` | **Secret** — RTU credentials only | unset (interpolated from compose `.env`) | **32-byte base64** AES-256-GCM key for RTU connection credentials (ADR 0012). Empty means not configured and the API declines to store credentials rather than storing plaintext. Must match the `ingest` service's key. See [`security/encryption-at-rest.md`](./security/encryption-at-rest.md) §3. |
| `OPENAI_API_KEY` | **Secret** — onboarding wizard only | unset | Enables the LLM path of the AI onboarding wizard (ADR 0011). When unset the wizard uses its deterministic rule-based fallback. |
| `OPENAI_MODEL` | No | `gpt-4o-mini` in `.env.example` | Chat completion model for the onboarding wizard. |

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
| `SIM_SITE_NAMES` | No | `RSMOC Western Cape,CSMOC Gauteng,RSMOC KwaZulu-Natal` in compose | Optional comma-separated seeded site names to limit simulator telemetry to selected demo locations. Assets with `meta.telemetryEnabled=false` are excluded even when their site is listed. |
| `SIM_METRICS_PORT` | No | `9101` | Prometheus metrics HTTP port exposed by the simulator. |

## Ingest (`apps/ingest`, PHE MQTT pilot)

Runs only with the `ingest` / `phe` / `pilot` compose profiles. Reads the
gitignored root `.env` via `env_file`.

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `DATABASE_URL` | Yes | `postgres://bms_app:bms_app_dev@postgres:5432/bms` | Postgres/TimescaleDB connection string. |
| `MQTT_HOST` | Yes | `phe.thinkiot.co.in` in compose | Pilot MQTT broker hostname. |
| `MQTT_PORT` | Yes | `8883` in compose | MQTT TLS port. |
| `MQTT_USERNAME` | **Secret** | unset (from `.env`) | Broker username. Never commit. |
| `MQTT_PASSWORD` | **Secret** | unset (from `.env`) | Broker password. Never commit. |
| `MQTT_RECONNECT_MS` | No | `5000` | Reconnect backoff period. |
| `MQTT_TLS_REJECT_UNAUTHORIZED` | No | unset (verification **on**) | Set to `false` to skip broker certificate verification. Local debugging only — must stay unset in any real deployment. |
| `CREDENTIAL_ENCRYPTION_KEY` | **Secret** | unset (from `.env`) | Same AES-256-GCM key as the API; used to decrypt stored per-RTU credentials (ADR 0012). |
| `INGEST_METRICS_PORT` | No | `9102` | Prometheus metrics HTTP port. |
| `INGEST_RELOAD_MS` | No | — | RTU configuration reload interval. |

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
