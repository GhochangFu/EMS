# apps/ml — the batch scorer (ADR 0135)

A Python 3.12 process that wakes hourly, reads `telemetry.point_values_1h` for
**real** points only, decides readiness per point, forecasts the points that
pass, and inserts `p10/p50/p90` rows into `ml.forecasts` under one
`ml.model_runs` row per organization. It connects as `bms_fleet` through
`DATABASE_URL_FLEET`, runs no DDL, makes no outbound call and exposes only
`GET /health` on `127.0.0.1`.

Since E1.2 (ADR 0135 Amendment 5) the same service runs a second job: after the
forecast, in **its own child process**, it scores the last complete hour of
each ready asset for anomalies and inserts the scores into `ml.anomaly_scores`
(see [The anomaly job](#the-anomaly-job)).

Decision record: [`docs/adr/0135-ml-serving-foundation.md`](../../docs/adr/0135-ml-serving-foundation.md).
Build plans: [`docs/plans/e1.1-ml-serving-foundation.md`](../../docs/plans/e1.1-ml-serving-foundation.md),
[`docs/plans/e1.2-anomaly-detection.md`](../../docs/plans/e1.2-anomaly-detection.md),
[`docs/plans/e1.2e-water-flow-anomaly-target.md`](../../docs/plans/e1.2e-water-flow-anomaly-target.md).

The model is **Chronos-2** (`amazon/chronos-2`, Apache-2.0) at an exact
revision, baked into the image at build time (ADR 0135 decision 7 and
Amendment 2 ruling 5; the measurement that chose it is in the ADR's build
record). Outside the image, `run-once` and `serve` exit 78 unless
`ML_MODEL_DIR` holds a baked model and its `MODEL.json`.

## The image

```bash
docker build -f apps/ml/Dockerfile --target runtime -t bms-ml .                    # from the repo root
docker build -f apps/ml/Dockerfile --target model-test -t bms-ml-model-test .
docker run --rm --network none bms-ml-model-test                                    # the model tests, offline
```

The fallback model is a build argument pair, changed together with the ADR's
build record: `--build-arg ML_MODEL_REPO=amazon/chronos-bolt-small
--build-arg ML_MODEL_REVISION=772f3d25d38aec6d914c8949dab4462e2d46f5d8`.
Locally the service is the compose profile `ml`
(`docker compose --profile core --profile ml up -d --build ml`).

## The demo host (ADR 0096; ADR 0135 Amendment 2 ruling 1)

The deploy workflow builds `ems-ml` for arm64 with the other images; a failed
`ems-ml` build never blocks the others. The service is off until an
administrator enables it, the choice survives deploys, and a deploy pulls the
2.8 GB image only while it is enabled. The first time:

1. Re-run `deploy/aws/setup-server.sh` on the host: `bms-ctl` is installed by
   it, not run from the checkout.
2. `sudo bms-ctl ml start` (or Actions -> "AWS demo services" -> `ml` ->
   `start`). If the image is not on the host yet, this only records the choice.
3. Run the deploy workflow once (Actions -> "Deploy to AWS demo"). It pulls
   `ems-ml` with its GHCR token and starts the service.

```bash
sudo bms-ctl ml status
sudo bms-ctl logs ml       # the hourly cycle_summary lines
```

On the host the service has one vCPU, 1 GiB with no swap beyond it, a
read-only root, and no network but Postgres. Before a rollback to a SHA from
before `ems-ml` existed, run `sudo bms-ctl ml stop`.

To stop the anomaly job and keep forecasts, set `ML_ANOMALY_ENABLED=false` in
the host's `.env` and recreate `ml`
([runbook](../../docs/runbooks/aws-demo-deployment.md#stop-the-anomaly-job-and-keep-forecasts)).

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
uv run python -m bms_ml eligibility [--job forecast|anomaly]   # readiness verdict of every target point
uv run python -m bms_ml run-once [--force] [--as-of 2026-11-15T12:00Z]
uv run python -m bms_ml run-anomaly [--force] [--as-of 2026-11-15T12:05Z]   # scores the hour before
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
| `ML_ANOMALY_ENABLED` | `true` | `true`, `false`, `1` or `0`; `false` stops the anomaly job, forecasts go on (both compose files pass it through) |
| `ML_ANOMALY_TARGETS` | 22 points (`targets.DEFAULT_ANOMALY_TARGETS`): ruling 1's 21 (15 energy meter points, `breaker_main`, `chlorine_pump_on`, three RTU health keys, `cold_room_temp_c`) and, since Amendment 7, `treated_water_flow_klh` of a water flow meter. Never a counter (`kwh_total`, `outlet_flow_totalizer_kl`) | `domain/asset_type/point_key`, at most 32 |
| `ML_MODEL_DIR` | `/opt/bms-ml/model` | the baked weights and `MODEL.json` |
| `ML_TORCH_THREADS` | unset | 1–64; set it to the container's CPU limit |
| `ML_HEALTH_PORT` | 4200 | 1024–65535 |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warning`, `error` |

## The anomaly job

ADR 0135 Amendment 5. `serve` runs it at every tick right after the forecast
child, as a child of its own (`run-anomaly --as-of <the tick's hour>`), so the
two never hold memory at once. Only that child imports scikit-learn; the
parent imports neither it nor torch, and `run-anomaly` needs no Chronos model.

- **What it scores.** The last complete hour of each asset whose every target
  point is ready (`eligibility --job anomaly` shows each point's verdict; one
  stale point holds its whole asset back).
- **Two detectors**, each writing one row per asset and hour with a score from
  0 to 1 (the share of the last 28 days' hours that were less unusual):
  - `baseline_mad`: a robust z of each point against its hour-of-week (or
    hour-of-day) median and MAD over 91 days; the asset takes its largest.
  - `isolation_forest`: scikit-learn's Isolation Forest over the asset's points
    together, fitted anew each cycle on the last 28 days; only for an asset
    with two or more points. No model is stored.
- **A flow meter** has one point, so it gets `baseline_mad` only. A stop at
  the same UTC hour every day is that hour's normal level. A stop in an hour
  that normally runs, or a run in an hour that is normally off, is unusual. A
  stop on one weekday reads unusual until the point has 56 days of data (ADR
  0135 Amendment 7 item 4; `tests/test_anomaly_zero_flow.py`).
- **Advisory only.** A score raises no alarm, notification, work order or
  report. The 0.99 "unusual" line is applied when the scores are read, never
  here.
- **Its run rows** are `ml.model_runs` with `model_name = 'bms-anomaly'`, one
  per organization; a scored hour is not scored again unless `--force`.
- **Health.** `GET /health` keeps the forecast's fields at the top level and
  adds `anomaly`: `{ "enabled", "cyclesSucceeded", "cyclesFailed",
  "lastCycle" }` (counts only). `status` is the worst of the enabled jobs.
- **Logs.** Each tick logs two `cycle_summary` lines; the anomaly one carries
  `"job": "anomaly"`, `baseline_rows`, `isolation_forest_rows` and the skip
  reasons.

**The budget (ruling 5)** is held in CI: the `ml` job's last step plants the
fixture at the real shape and runs each child in its own container at the demo
host's limits (`--cpus 1 --memory 1g`), once in CI (`--runs 1`, the owner's
ruling to save Actions minutes; the default is three runs locally)
(`tests/integration/measure_cycle.py`). It fails when the anomaly child peaks
above 900 MiB or forecast + anomaly take more than 300 s; then the owner rules
again. Locally, with the integration database below and the image built as
`bms-ml`:

```bash
uv run python -m tests.integration.measure_cycle --image bms-ml --network host
```

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
uv run python -m tests.integration.fixture --extra-ready 17 --ahead-days 95 --anomaly-shape   # T1.10's shape
```

## Rules this app holds itself to

- **All SQL is in `src/bms_ml/db/sql.py`**, reads of the inputs and inserts into
  `ml.*` only; only `db/gateway.py` imports psycopg (`tests/test_sql_guard.py`).
- **Gaps stay NaN**, never filled (`tests/test_no_imputation.py`).
- **No secret and no exception message in a log line or a run row**: a failure
  is `<stage>:<ExceptionClass>`.
- Python naming follows Python: `snake_case` modules, `tests/test_*.py`
  (plan R17).
