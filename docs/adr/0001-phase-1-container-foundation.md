# ADR 0001: Phase 1 Container Foundation
Date: 2026-04-28
Status: accepted

## Context

The prototype was built for native WSL development with local Postgres and
TimescaleDB. Phase 1 Sprint A needs a reproducible path for a fresh
developer machine and a single-VM pilot without forcing an 8 GB laptop to
run the full future production stack.

## Decision

Add Dockerfiles for the API, web app, and simulator, plus a root
`docker-compose.yml` with explicit profiles:

- `core` starts the minimum app path: Postgres/TimescaleDB, API, and web.
- `migrate` runs Drizzle migrations and seed data against the compose DB.
- `sim` starts the telemetry simulator when live data is needed.
- `pilot` starts the core app plus simulator for demo-like runs.

GitHub Actions will validate installs, workspace builds/typechecks, and
database migrations against a real TimescaleDB service.

## Consequences

Native WSL development remains supported. Docker Compose becomes the
reproducible development and pilot path, but heavier Phase 1 services
such as Redis, Keycloak, Prometheus, Grafana, and Loki remain deferred to
later Sprint B-D work.

## Alternatives Considered

- **One all-in compose stack:** rejected for Sprint A because it would
  immediately add Keycloak, Redis, and observability overhead before the
  codebase is ready for those integrations.
- **Kubernetes first:** rejected because Sprint A targets a single-VM
  pilot path and laptop-friendly development.
