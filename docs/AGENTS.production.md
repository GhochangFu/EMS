# AGENTS.production.md — Eskom SMOC BMS (Production Target)

> **Status:** REFERENCE / NORTH STAR.
> **Active rulebook:** `/AGENTS.md` at the repo root.
>
> Sections of this file are promoted into the active rulebook as the
> system grows out of the prototype. Do not assume a section here is
> enforced today — check `/AGENTS.md` first.

This file describes how the Eskom SMOC BMS will be built, reviewed, and
shipped at production scale. The product UX reference is
`ESKOM_SMOC.html` at the repo root.

---

## 1. Mission & Scope

Build a multi-site, real-time, secure BMS that:

1. Ingests telemetry from power stations, smart meters, HVAC, electrical,
   security, fire, and IT-load systems via BACnet, Modbus, MQTT, SNMP,
   REST and OPC-UA.
2. Surfaces live operational state through dashboards, maps, schematics,
   3D control rooms, alarm centre, energy analytics, and reports.
3. Allows audited two-way commands (setpoints, mode changes, breaker
   operations) only via approval workflow.
4. Meets NERSA, ISO 50001, and internal Eskom audit requirements.

Out of scope until explicitly approved: direct grid dispatch, market
trading, billing collection.

---

## 2. Tech Stack

| Layer            | Technology |
|------------------|------------|
| Frontend         | React 18, TypeScript 5, Vite, Tailwind CSS, TanStack Query, Zustand, React Router, Leaflet, Three.js, ECharts, shadcn/ui |
| Backend API      | NestJS (Node 20 LTS, TypeScript) |
| Realtime         | NestJS WebSocket gateway over Socket.IO with Redis adapter |
| Workers / jobs   | NestJS BullMQ workers (Redis-backed) |
| Ingestion        | Node services per protocol: BACnet, Modbus, SNMP, REST poller, OPC-UA, MQTT subscriber |
| MQTT broker      | EMQX 5 (TLS, ACL, bridges) |
| OLTP DB          | PostgreSQL 16 |
| Telemetry DB     | TimescaleDB 2.x extension on the same Postgres |
| ORM / migrations | Drizzle ORM for tables; raw SQL for hypertables, retention, continuous aggregates |
| Cache / pub-sub  | Redis 7 |
| Object storage   | MinIO (S3 API) |
| Auth             | Keycloak 24 (OIDC, MFA, SSO/AD federation) |
| Reverse proxy    | Traefik 3 |
| Observability    | Prometheus, Grafana, Loki, OpenTelemetry SDK |
| CI/CD            | GitHub Actions |
| Containers       | Docker (dev & prod), Kubernetes (prod) |

No library or service may be added unless listed here or approved via an
ADR (§15).

---

## 3. Repository Layout

```
bms/
├── AGENTS.md                ← active rulebook
├── README.md
├── ESKOM_SMOC.html          ← UX reference
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.yml
├── infra/
│   ├── k8s/
│   ├── traefik/
│   ├── keycloak/
│   └── grafana/
├── apps/
│   ├── web/
│   ├── api/
│   ├── ingest/
│   │   ├── bacnet/
│   │   ├── modbus/
│   │   ├── mqtt/
│   │   ├── snmp/
│   │   └── opcua/
│   └── worker/
├── packages/
│   ├── shared/
│   ├── db/
│   ├── ui/
│   ├── contracts/
│   └── telemetry-sdk/
└── docs/
    ├── adr/
    ├── api/
    ├── runbooks/
    ├── AGENTS.production.md  ← this file
    └── roadmap.md
```

---

## 4. Naming, Style, and Language Rules

### 4.1 General
- File names: `kebab-case` for files, `PascalCase` for React components,
  `camelCase` for variables and functions, `SCREAMING_SNAKE_CASE` for
  env vars and SQL constants.
- Never abbreviate domain terms (`asset`, `alarm`, `gateway`).
- Max **1600 lines per file**. Refactor before crossing.
- No `any` in TypeScript. Use `unknown` and narrow.
- No `console.log` in shipped code. Use the structured logger.

### 4.2 TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`,
  `exactOptionalPropertyTypes: true`.
- All exported functions need JSDoc with `@param`, `@returns`, `@throws`.
- Prefer pure functions; isolate side effects in services.
- Discriminated unions over enums for protocol/status types.

### 4.3 React
- Functional components only. One component per file.
- Container/presentational separation: data in hooks (`useAssets`,
  `useAlarmsLive`), rendering in dumb components.
- All API calls go through TanStack Query hooks in
  `apps/web/src/api/`.
- Global UI state: Zustand stores per slice. No Redux.
- Styling: Tailwind utilities + design tokens in `packages/ui/theme`.
  Inline `style` only for dynamic values.

### 4.4 Node / NestJS
- Module-per-domain: `assets`, `alarms`, `telemetry`, `commands`,
  `users`, `audit`, `reports`, `rules`, `gateways`.
- Controllers thin; logic in services; data access in repositories.
- Validate every DTO with Zod. Never trust controller input.
- All async calls have timeouts. No unbounded `await`.

### 4.5 SQL (Postgres / TimescaleDB)
- Schema-qualify everything (`bms.assets`, `telemetry.meter_readings`).
- PKs: `BIGINT GENERATED ALWAYS AS IDENTITY` for hot tables; `UUID` only
  when externally exposed.
- `TIMESTAMPTZ` everywhere; never `TIMESTAMP WITHOUT TIME ZONE`.
- `NUMERIC(p, s)` for currency and unit prices.
- All tables have `created_at`, `updated_at`, `created_by`, `updated_by`.
- Telemetry tables are TimescaleDB hypertables with:
  - `chunk_time_interval = 1 day` — **implemented** (ADR 0001)
  - `compress_after = 7 days` — **implemented** on raw and on `_1m`/`_5m`
    (ADR 0024, migration `0028`). `_1h`/`_1d` are deliberately **not** compressed.
  - `drop_after = 2 years` — **implemented** as `730 days` on raw. `_1m`/`_5m` are
    `735 days`: an aggregate must outlive its source *strictly*, or the two
    independent policy schedules can leave raw holding a period its aggregate does
    not, which reads as empty and cannot be repaired. `_1h`/`_1d` are **never
    dropped** (ADR 0023 decision 7) — after raw's 730 days they are the only
    record of the period, at hourly resolution.
  - *Per-tenant retention override* — **still aspirational.** Nothing implements
    it; it belongs with multi-tenancy (Phase 3), not with ADR 0024. This line read
    as shipped for months before either policy existed, which is why the four
    above now say which they are.
  - Continuous aggregates for 1m, 5m, 1h, 1d rollups — **implemented**
    (ADR 0023, migration `0027`), hierarchical rather than four scans of raw, with
    no `avg_value` column at any level.
- Parameterised queries only. No string concatenation.
- Long-running deletes / updates batched at 5,000 rows max.
- Migrations forward-only.

---

## 5. Database & Domain Model (canonical)

Authoritative schema lives in `packages/db/schema/*.ts`. Core entities:

- `bms.tenants`
- `bms.sites` → `bms.buildings` → `bms.floors` → `bms.zones`
- `bms.power_stations`
- `bms.assets` → `bms.asset_points`
- `bms.gateways` → `bms.gateway_devices`
- `telemetry.meter_readings` (hypertable)
- `telemetry.point_values` (hypertable)
- `telemetry.point_values_1m` / `_5m` / `_1h` / `_1d` (continuous aggregates)
- `bms.alarms` → `bms.alarm_events` → `bms.alarm_acknowledgements`
- `bms.work_orders` → `bms.work_order_tasks`
- `bms.automation_rules` → `bms.rule_executions`
- `bms.commands` → `bms.command_results` (two-phase commit log)
- `bms.users`, `bms.roles`, `bms.user_roles`, `bms.permissions`
- `bms.audit_log` (append-only, partitioned monthly, hash-chained nightly)
- `bms.reports`, `bms.report_runs`

Naming rules: tables plural, columns snake_case, FKs `<table>_id`.

---

## 6. API Conventions

- REST under `/api/v1/...`. JSON only. Validated against Zod schemas in
  `packages/contracts`.
- WebSocket namespaces: `/ws/telemetry`, `/ws/alarms`, `/ws/commands`.
- Pagination: cursor-based (`?cursor=...&limit=...`). No offset for hot
  tables.
- Errors follow RFC 7807 Problem Details:
  ```json
  { "type": "...", "title": "...", "status": 409, "detail": "...",
    "instance": "...", "traceId": "..." }
  ```
- Every request and event carries a `correlation_id` propagated through
  logs and audit.
- State-changing endpoints accept `Idempotency-Key`.
- Auth: OIDC bearer token from Keycloak. RBAC via `@Roles()` decorator
  and per-resource policy guards.

---

## 7. Realtime & Ingestion Rules

- Browser realtime is **read-only**. Commands go via HTTP POST so they
  hit auth + audit + idempotency middleware.
- Protocol adapters publish to MQTT topics under
  `bms/<tenant>/<site>/<gateway>/<asset>/<point>`. The ingestion service
  is the **only** writer to `telemetry.*` tables.
- Backpressure: every adapter handles broker disconnects with
  exponential backoff (max 60 s) and a local disk buffer (rolling 1 h).
- Clock skew: timestamps are UTC at source; if the device clock is
  unreliable, the gateway stamps `ingest_time` and we keep both columns.

---

## 8. Commanding & Safety

Two-way control is the highest-risk surface in a BMS. Every command
must:

1. Be initiated by an authenticated user with the matching permission.
2. Carry a free-text `reason` (audited).
3. Pass a server-side **safety gate** that checks asset state,
   interlocks, time-of-day windows, role limits.
4. Optionally require **dual approval** for assets flagged
   `requires_approval = true` (DG start, breaker ops, fire panel,
   chiller emergency stop).
5. Be persisted in `bms.commands` *before* dispatch.
6. Be sent via the gateway with a correlation ID and a hard timeout.
7. Record `bms.command_results` with ack / nack / timeout.
8. Emit a WebSocket event so UI updates the dispatch table live.

There is no "debug-only" bypass.

---

## 9. Security

- Secrets only in Vault / Kubernetes secrets — never in code, env files
  in git, or chat.
- All inter-service traffic is mTLS inside the cluster.
- Browser → API: TLS 1.3 only.
- Passwordless preferred (OIDC + MFA via Keycloak).
- Least privilege at the DB level: API uses a role with CRUD on its own
  schemas, no `SUPERUSER`.
- Row-level security on every cross-tenant `bms.*` table. `telemetry.*` is a
  stated, **permanent** exception (ADR 0043 decision 9): isolation there is
  application-layer only, through `readableAssetIds`, because a per-row join
  to `bms.assets` would collide with the ADR 0023/0024 aggregate and
  retention jobs. This line predates that ruling and read as an unqualified
  blanket target; it is not one, and revisiting the `telemetry.*` exception
  needs its own ADR. (This section is aspirational throughout, per the file
  header — see AGENTS.md §2's *Tenancy* row for what is actually built.)
- Input validation on the edge **and** at the service boundary.
- Rate limiting at Traefik per IP and at API per user / IP.
- Audit log is append-only; nightly hash-chained.
- OWASP ASVS Level 2 minimum, Level 3 for command and audit modules.

---

## 10. Testing Standards

- Coverage: **80% lines / 70% branches** baseline; **95%** for command,
  alarm, audit, RBAC modules.
- Unit (Vitest): fast, no I/O, run on save.
- Integration (Vitest + testcontainers): real Postgres + Timescale + Redis.
- Contract tests: API ↔ web verified against Zod schemas in
  `packages/contracts`.
- E2E (Playwright): critical paths from `ESKOM_SMOC.html` —
  login → dashboard, alarms ack, command dispatch, energy report,
  campus drilldown, command audit.
- Load (k6): each release validates 5,000 meters @ 1 Hz and 1,000
  concurrent dashboard users.

---

## 11. Observability

- Every service exposes `/metrics` (Prometheus) and `/health`.
- Structured JSON logs with `service`, `env`, `traceId`, `userId`,
  `correlationId`.
- OpenTelemetry traces span: HTTP → service → DB → external.
- Grafana dashboards live in `infra/grafana/dashboards/` as code.
- SLO targets:
  - API p95 < 250 ms
  - WebSocket fan-out p95 < 500 ms
  - Alarm pipeline (telemetry → UI) p99 < 2 s
  - Command round-trip p99 < 3 s

---

## 12. Performance Budgets (frontend)

- Initial JS bundle ≤ 250 kB gzip.
- LCP ≤ 2.5 s on a 4G profile.
- Each route lazy-loaded. Heavy modules (Three.js, Leaflet, ECharts)
  loaded on demand.
- Profile chart-heavy pages with React DevTools before merge.

---

## 13. Definition of Done (Production)

A task is done when:

1. Code merged to `main` with green CI.
2. Unit + integration tests added/updated and passing.
3. OpenAPI contract updated if any endpoint changed.
4. Storybook story added/updated for any new shared component.
5. Logs, metrics, traces emit on the new path.
6. Audit entry written for any new state-changing path.
7. Docs updated: package README + ADR if architecture changed.
8. RBAC matrix updated if new permission introduced.
9. Demoed against the matching screen in `ESKOM_SMOC.html`.

---

## 14. Git, Branching, and Reviews

- Trunk-based development. Branches:
  `feat/<phase>-<slug>`, `fix/<slug>`, `chore/<slug>`.
- Conventional Commits (`feat(api): add command approval guard`).
- PR ≤ 400 lines diff where possible.
- Two reviewers for `apps/api/src/commands/**`,
  `apps/api/src/audit/**`, `packages/db/migrations/**`.
  One reviewer elsewhere.
- No PR may lower coverage or add a TODO without a linked ticket.

---

## 15. Architecture Decision Records (ADR)

Every non-obvious choice goes in `docs/adr/NNNN-title.md`:

```
# ADR NNNN: <title>
Date: YYYY-MM-DD
Status: proposed | accepted | superseded by NNNN
Context: ...
Decision: ...
Consequences: ...
Alternatives considered: ...
```

Adding / removing libraries, changing a protocol, breaking schema
changes — all require an ADR before implementation.

---

## 16. AI Agent Operating Rules (Production)

1. **Context first.** Read the affected files and `AGENTS.md` before
   editing.
2. **Never modify** `packages/db/migrations/*` once merged. Add new
   migrations only.
3. **Never bypass** the command safety gate or audit middleware.
4. **Never log** secrets, tokens, or full PII payloads.
5. **Always run** `pnpm lint && pnpm test` before declaring done.
6. **Ask before** adding a dependency, changing public API, or altering
   RBAC / permissions.
7. **Match style** of existing modules. Copy the closest pattern.
8. Do not create files outside the layout in §3.
9. Do not mass-rename or mass-format unrelated code.
10. Update `AGENTS.md` only via a PR prefixed `chore(agents): ...` with
    one approver from the architecture council.

---

## 17. Promotion from Prototype to Production

When the prototype is signed off and add-on phases begin, sections of
this file are promoted into the active `AGENTS.md` per the Promotion
Process in `/AGENTS.md` §10. Promotions are logged in `docs/decisions.md`
during prototype phase and become ADRs from the first production phase
onward.

---

## 18. Glossary

- **SMOC** — Smart Metering Operating Centre.
- **BMS** — Building Management System.
- **IBMS** — Integrated Building Management System.
- **PUE** — Power Usage Effectiveness.
- **SLD** — Single-Line (electrical) Diagram.
- **CRAC** — Computer Room Air Conditioner.
- **AHU** — Air Handling Unit.
- **AMC** — Annual Maintenance Contract.
- **NERSA** — National Energy Regulator of South Africa.
- **MTTR** — Mean Time To Repair.
- **PPM** — Planned Preventive Maintenance.
- **ASHRAE** — American Society of Heating, Refrigerating and
  Air-Conditioning Engineers.
- **DG** — Diesel Generator.
- **UPS** — Uninterruptible Power Supply.
- **DCIM** — Data Center Infrastructure Management.
- **PDU** — Power Distribution Unit.
- **CSP** — Concentrated Solar Power.
- **OIDC** — OpenID Connect.
- **RBAC** — Role-Based Access Control.
- **RLS** — Row-Level Security (Postgres).

---

## 19. Living Document

This file is the long-term north star. It evolves alongside the active
`AGENTS.md`. Treat changes here with the same rigour as code: PR,
review, ADR if architectural.
