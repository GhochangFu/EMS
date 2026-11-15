# apps/ml — the batch scorer (ADR 0135)

A Python 3.12 process that wakes hourly, reads `telemetry.point_values_1h` for
**real** points only, decides readiness per point, forecasts the points that
pass, and inserts `p10/p50/p90` rows into `ml.forecasts` under one
`ml.model_runs` row per organization. It connects as `bms_fleet` through
`DATABASE_URL_FLEET`, runs no DDL, makes no outbound call and exposes only
`GET /health` on `127.0.0.1`.

Decision record: [`docs/adr/0135-ml-serving-foundation.md`](../../docs/adr/0135-ml-serving-foundation.md).
Build plan: [`docs/plans/e1.1-ml-serving-foundation.md`](../../docs/plans/e1.1-ml-serving-foundation.md).

> **This build has no model.** Plan PR 3 is the pipeline with a fake model in
> the tests. `run-once` and `serve` exit 78 ("no model installed in this
> build") until plan PR 4 adds Chronos; `preflight` and `eligibility` work.

## Toolchain

Managed with [uv](https://docs.astral.sh/uv/) at the version that wrote
`uv.lock` (`0.8.13`, the same as CI). Dependencies change only through `uv add`
/ `uv lock` from a shell, with ADR 0135 amended in the same commit: the
dependency gate refuses a tool edit of `pyproject.toml` dependencies and any
edit of `uv.lock`.

```bash
cd apps/ml
uv sync --frozen
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

## Commands

```bash
uv run python -m bms_ml preflight              # schema version marker and role check
uv run python -m bms_ml eligibility            # readiness verdict of every target point
uv run python -m bms_ml run-once [--force] [--as-of 2026-11-15T12:00Z]
uv run python -m bms_ml serve                  # the hourly loop, GET /health on loopback
uv run python -m bms_ml health                 # the Docker HEALTHCHECK client
```

Exit codes: `0` ok (a partial failure is counted and logged, then retried at the
next tick), `1` every organization the cycle tried failed (retried in 300 s, or
at the next tick when 300 s would cross into the next hour), `78`
configuration, schema, role or model refused (the loop stops).

| Variable | Default | Rule |
|---|---|---|
| `DATABASE_URL_FLEET` | — | required; no fallback to `DATABASE_URL` |
| `ML_INTERVAL_SECONDS` | 3600 | a multiple of 900 that divides 86400 (ticks at :05, :20, :35 or :50) |
| `ML_CYCLE_TIMEOUT_SECONDS` | 900 | 60 to interval − 60 |
| `ML_FORECAST_HORIZON_HOURS` | 48 | 1–64 |
| `ML_CONTEXT_HOURS` | 2016 | 336–2048 |
| `ML_FORECAST_TARGETS` | `facility/cold_room/cold_room_temp_c,electrical/energy_meter/kw` | `domain/asset_type/point_key`, at most 32 |
| `ML_MODEL_DIR` | `/opt/bms-ml/model` | read by plan PR 4 |
| `ML_TORCH_THREADS` | unset | 1–64 (plan PR 4) |
| `ML_HEALTH_PORT` | 4200 | 1024–65535 |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warning`, `error` |

## The integration suite

`tests/integration` runs the scorer as `bms_fleet` against a real TimescaleDB.
It needs `ML_TEST_DATABASE_URL_SUPERUSER` and `ML_TEST_DATABASE_URL_FLEET`:
unset, it skips locally and **fails under CI**. It refuses any database not
named `bms_ml_test`, because its fixture deletes and plants rows.

A throwaway database, from the repository root:

```bash
docker run -d --name bms-ml-test-pg -p 127.0.0.1:5434:5432 -e POSTGRES_DB=bms_ml_test -e POSTGRES_USER=bms_app -e POSTGRES_PASSWORD=bms_app_dev timescale/timescaledb:2.29.1-pg16
docker exec bms-ml-test-pg psql -U bms_app -d bms_ml_test -c "CREATE EXTENSION IF NOT EXISTS timescaledb; CREATE SCHEMA IF NOT EXISTS bms AUTHORIZATION bms_app; CREATE SCHEMA IF NOT EXISTS telemetry AUTHORIZATION bms_app;"
```

Then, with `DATABASE_URL=postgres://bms_owner:bms_owner_dev@127.0.0.1:5434/bms_ml_test`,
`DATABASE_URL_SUPERUSER=postgres://bms_app:bms_app_dev@127.0.0.1:5434/bms_ml_test`
and the four `BMS_*_PASSWORD` dev values set:

```bash
pnpm --filter @bms/db roles
pnpm db:migrate
pnpm db:seed
```

And in `apps/ml`, with
`ML_TEST_DATABASE_URL_SUPERUSER=postgres://bms_app:bms_app_dev@127.0.0.1:5434/bms_ml_test` and
`ML_TEST_DATABASE_URL_FLEET=postgres://bms_fleet:bms_fleet_dev@127.0.0.1:5434/bms_ml_test`:

```bash
uv run pytest tests/integration
uv run python -m tests.integration.fixture     # plant the fixture alone; prints as_of and the target
```

## Rules this app holds itself to

- **All SQL is in `src/bms_ml/db/sql.py`**, reads of the inputs and inserts into
  `ml.*` only; only `db/gateway.py` imports psycopg (`tests/test_sql_guard.py`).
- **Gaps stay NaN**, never filled (`tests/test_no_imputation.py`).
- **No secret and no exception message in a log line or a run row**: a failure
  is `<stage>:<ExceptionClass>`.
- Python naming follows Python: `snake_case` modules, `tests/test_*.py`
  (plan R17).
