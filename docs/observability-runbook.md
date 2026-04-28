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

## Laptop Notes

- Stop observability services when you are done:
  `docker compose --profile observability down`.
- If Docker memory pressure appears, run only the core app first, then add
  the observability profile after the web app is usable.
