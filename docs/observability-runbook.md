# Observability Runbook

Phase 1 Sprint D adds an optional local/pilot observability profile.
Keep it off during normal 8 GB laptop development unless you are checking
health or preparing a demo.

## Start

```bash
docker compose --profile core --profile sim --profile observability up --build
```

## URLs

- Web app: `http://localhost:5173`
- API health: `http://localhost:4000/health`
- API metrics: `http://localhost:4000/metrics`
- Simulator metrics: `http://localhost:9101/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000` (`admin` / `admin`)
- Loki: `http://localhost:3100`

## Demo Health Check

1. Open Grafana and select **BMS Pilot Overview**.
2. Confirm API request rate and p95 latency are updating.
3. Confirm simulator ingest rate is greater than zero when `sim` is running.
4. Visit the Alarm Centre and acknowledge one alarm.
5. Confirm alarm event and websocket event counters move.
6. In Grafana Explore, choose Loki and query `{service="api"}` or
   `{service="sim"}` to inspect container logs.
7. Confirm `bms_api_telemetry_listener_connected` is **1** on
   `http://localhost:4000/metrics`.

## Realtime is dead but the API is up

`bms_api_telemetry_listener_connected` is the signal (`F4.34`). It is `1` while
the API holds its `LISTEN bms_telemetry` subscription and `0` otherwise.

**This is the one failure the rest of the dashboard cannot show you.** Request
rate, latency and ingest rate all stay healthy while every live tile stops
updating, because telemetry is still being written — it just is not being
announced to anyone.

- **Gauge 0, ingest `written=` climbing** → the fault is on the API side. The
  listener reconnects on its own with the ADR 0016 §5 backoff (1 s doubling to a
  60 s ceiling), so a gauge that returns to 1 by itself is expected; one that
  stays 0 means Postgres is refusing the connection. Check the API logs for
  `bms_telemetry listener lost:` — the reason is interpolated into that line.
- **`bms_api_telemetry_listener_reconnects_total` climbing steadily while the
  gauge flaps** → something accepts the connection then drops it (pgbouncer at
  its pool limit, a replica in recovery). The listener escalates its backoff in
  this case rather than hammering, so the counter's *rate* is the diagnostic.
- **`bms_api_telemetry_readings_dropped_total` climbing** → something is
  publishing readings in a shape the contract does not allow (`F4.36`). This is
  a *different* fault from the two above: the listener is healthy and connected,
  and telemetry is arriving — it is just being refused. `NOTIFY` requires **no
  table privilege**, so any role that can connect to the database can write to
  that channel; a non-zero counter with no known producer change is worth
  treating as an unknown writer rather than a bug. The API log names the failing
  **field paths** (never values): `Dropped N invalid bms_telemetry reading(s);
  fields: …`. A `<overflow>` field means the payload exceeded the 500-reading
  cap, which no legitimate producer approaches — the widest real chunk is 63.
  Note the counter counts **readings**, not payloads: a broken *envelope*
  (non-JSON, or `readings` not an array) logs `Failed to parse bms_telemetry
  payload` and increments nothing, so do not alert on this counter alone.
- **Readings published while the gauge is 0 are gone from the live push.**
  `NOTIFY` has no replay. Nothing is lost from history — the rows are in the
  hypertable and the UI re-seeds from `GET /telemetry/points/:pointRef/recent` —
  so a page refresh recovers the chart even though the missed ticks never
  arrive as live events.

Before `F4.34` this state was not merely invisible: an unhandled `error` event
took the whole API process down, so the symptom was a dead API rather than a
stale dashboard.

## Laptop Notes

- Stop observability services when you are done:
  `docker compose --profile observability down`.
- If Docker memory pressure appears, run only the core app first, then add
  the observability profile after the web app is usable.
