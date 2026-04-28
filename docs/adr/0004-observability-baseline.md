# ADR 0004: Observability Baseline

## Status

Accepted for Phase 1 Sprint D.

## Context

The prototype and early pilot hardening work can now run through Docker
Compose with Postgres, Redis, Keycloak, API, web, and simulator services.
Before a pilot demo, developers need a lightweight way to confirm whether
the API, websocket path, simulator ingest loop, and logs are healthy.

The development laptop has 8 GB RAM, so observability services must not be
part of the default core stack.

## Decision

Add an optional `observability` compose profile with:

- Prometheus for scraping API and simulator metrics.
- Grafana for dashboards provisioned from code.
- Loki for log storage.
- Promtail for collecting local Docker container logs.

The API and simulator will expose Prometheus metrics directly. The API
will also include an environment-gated OpenTelemetry SDK bootstrap so
future trace export can be enabled without changing application code.

## Consequences

- The core compose path remains lighter for day-to-day laptop use.
- Sprint D proof can use `docker compose --profile observability up`.
- Dashboards and observability config live under `infra/observability/`.
- Production-grade retention, alerting, tracing backends, and SLO paging
  are intentionally deferred beyond this baseline.
