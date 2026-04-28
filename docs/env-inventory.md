# Environment Inventory

Phase 1 Sprint A keeps the prototype variables and adds compose defaults
for reproducible development. Real secrets still belong in uncommitted
`.env` files or deployment secret stores.

## API

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `DATABASE_URL` | Yes | `postgres://bms_app:bms_app_dev@postgres:5432/bms` | Postgres/TimescaleDB connection string. |
| `JWT_SECRET` | Yes | `change-me-in-compose` | Prototype JWT signing secret until Keycloak arrives in Sprint C. |
| `JWT_TTL` | No | `8h` | Prototype JWT lifetime. |
| `PORT` | No | `4000` | API HTTP and Socket.IO port. |
| `LOG_LEVEL` | No | `info` | Pino log level. |
| `ENERGY_TARIFF_ZAR_PER_KWH` | No | `2.15` | Indicative Energy Centre cost calculation. |

## Web

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `VITE_API_URL` | Yes | `http://localhost:4000` | Browser-facing API base URL baked into the Vite build. |
| `VITE_WS_URL` | Yes | `ws://localhost:4000` | Browser-facing Socket.IO base URL baked into the Vite build. |

## Simulator

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `DATABASE_URL` | Yes | `postgres://bms_app:bms_app_dev@postgres:5432/bms` | Postgres/TimescaleDB connection string. |
| `SIM_RATE_HZ` | No | `1` | Simulator write frequency. |
| `SIM_ASSET_COUNT` | No | `32` | Maximum seeded assets loaded by the simulator. |

## Database Container

| Variable | Required | Default / compose value | Purpose |
|----------|----------|-------------------------|---------|
| `POSTGRES_DB` | Yes | `bms` | Database name created by the TimescaleDB image. |
| `POSTGRES_USER` | Yes | `bms_app` | Application database role. |
| `POSTGRES_PASSWORD` | Yes | `bms_app_dev` | Local development password only. |
