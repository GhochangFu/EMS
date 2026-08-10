# AGENTS.md — TRINETRA Enterprise EMS (Ion Exchange line) (Part 2 / Phase 5 Location and Access + Onboarding & PHE Ingest)

> **Status:** ACTIVE — **SOW-driven backlog delivery** (`docs/BACKLOG.md`,
> Wave 0/1), running on the loop in `docs/build-operating-model.md`. Phase 5
> Sprint J/K/L/M/N Location and Access hardening remains open alongside it.
> Merged and in scope: the hierarchical master-data admin, the scoped AI
> onboarding wizard, and the PHE MQTT real-ingestion pilot (ADR 0007–0012);
> the Vitest gate (ADR 0014), asset templates and instantiation
> (ADR 0015), the ingest adapter framework **and its host** (ADR 0016), the
> operations write matrix (ADR 0017), the asset source-axis separation
> (ADR 0018), the template content model (ADR 0019), the audit read API
> (ADR 0021), and onboarding credential capture off the chat transcript
> (ADR 0022). General
> site-wide AI copilot, EMQX, and the **non-MQTT**
> protocol adapters remain deferred — the framework, the host and the MQTT
> adapter are promoted; each further protocol still needs its own ADR (§9.4).
> **Product brand:** TRINETRA. Powered by Euphoria Infotech India Limited.
> **Product line:** Enterprise EMS for Ion Exchange (India) Ltd. per
> **ADR 0013** — forked from the Eskom SMOC engagement (earlier branding:
> Eskom SMOC / InfraPulse). Eskom-era internal identifiers, seed demo data,
> and the `ESKOM_SMOC.html` mockups are intentionally retained; the pending
> SOW-driven scope is tracked in `docs/BACKLOG.md`.
> **North star:** see `docs/AGENTS.production.md` for the full production
> rules we will promote from as the system grows.
> **Recent scope changes:** see `docs/adr/` and `git log`. ADRs are the live
> record of what is in scope; where this file conflicts with a newer ADR, the
> **ADR is authoritative** and this file is the thing to fix. Scope moves via
> §10, and edits here move via a `chore(agents):` PR (§9.10) — which is why
> this file lags and the ADRs do not.

This file is the rulebook humans and AI agents must follow **right now**.
The seven-screen prototype is complete. Phase 1 Sprint A added
container foundations and CI. Sprint B added Redis-backed Socket.IO
fan-out. Sprint C added Keycloak/OIDC authentication for the web app and
protected API routes. Sprint D added an optional observability baseline
for local/pilot diagnostics. Phase 2 Sprint 0 selected Path B because no
real device/source information is available yet. Real protocol adapters
and brokers remain out of scope until a future Phase 2 implementation
sprint promotes one confirmed source/protocol. Phase 5 Sprint A added the
work order foundation: schema, seed/demo data, and protected API endpoints
for listing, creating, and transitioning work orders. Phase 5 Sprint B
added the web UI for operators to create, track, reorder, and close work
orders. Phase 5 Sprint C added maintenance schedule templates, recurring
schedules, asset-linked history, and conversion into work orders from a
dedicated Schedule Centre companion screen. Phase 5 Sprint D added the
basic rule engine: simple threshold/time-window rules, execution history,
and enable/disable UI without a complex visual builder. Phase 5 Sprint E
added Energy report previews plus CSV export only. Phase 5 Sprint F report
storage is skipped for now and can be revisited later. Phase 5 Sprint G
added the first 2D IBMS Control Room foundation screens: CR Main Dashboard,
CR Electrical SLD, and CR IT & Rack Load. Phase 5 Sprint H added a guided
IF/THEN visual rule builder for the existing simple
threshold/time-window rule model. The Phase 5 Control Room extension added
the previously deferred UPS Monitoring, Battery Bank, HVAC System,
Environment, and CR Dashboard integration screens before Sprint I.
Phase 5 Sprint I aligned completed pages to the `ESKOM_SMOC.html` shell,
headers, cards, status pills, disabled command affordances, and demo flow
without changing backend contracts. The later Location and Access work
introduced canonical locations, scoped users, location dashboards,
asset-group UI guards, focused simulator settings, telemetry dashboard
indexing, and shell/sidebar refinements. Phase 5 Sprint J/K/L/M/N is now
open for focused Location and Access hardening, demo inventory cleanup,
clean migration/seed verification, Keycloak checks, automated access tests,
and role-walkthrough hardening.

Beyond the Location and Access sprint, three feature streams have since been
merged to `main` and are in scope. The **hierarchical master-data admin**
(ADR 0008–0010) introduced the `Organization → Location → RTU → Asset → Point
Key` catalog with scoped `admin`, `organization_admin`, and `location_admin`
roles and CRUD screens under `/admin/*`. The **scoped AI onboarding wizard**
(ADR 0011) adds an admin-only conversational ingestion flow backed by OpenAI
chat completions with a deterministic rule-based fallback. The **PHE MQTT
real-ingestion pilot** (ADR 0007, 0012) added `apps/ingest`, a single-RTU MQTT
TLS subscriber for West Bengal PHE pump houses, plus AES-256-GCM encrypted RTU
connection credentials. These promotions are partial and scoped: general
site-wide AI copilot, EMQX, and non-MQTT protocol adapters remain out of scope.

---

## 1. Goal

The prototype has completed the seven-screen end-to-end pipeline:

`simulated device → Postgres/Timescale → NestJS API → WebSocket → React UI → user`

The current planning direction is:

1. Keep the simulator as the active source until real access is available.
2. Treat Phase 5 Sprint A work order foundation as complete.
3. Treat Phase 5 Sprint B work order UI as complete.
4. Treat Phase 5 Sprint C Maintenance Schedule Centre as complete.
5. Treat Phase 5 Sprint D basic rule engine as complete.
6. Treat Phase 5 Sprint E Energy report previews and CSV export as
   complete.
7. Skip Phase 5 Sprint F report storage for now; revisit only if persisted
   report files/history are needed.
8. Treat Phase 5 Sprint G Control Room foundation as complete: 2D React
   screens backed by seeded assets, simulator telemetry, and rule-driven
   status where current data exists.
9. Treat Phase 5 Sprint H guided visual rule builder as complete without
   two-way commanding, free-form node graphs, schedulers, or real-ingestion
   rules.
10. Treat the Phase 5 Control Room extension as complete for CR UPS
   Monitoring, Battery Bank, HVAC System, Environment, and CR Dashboard
   integration.
11. Treat Phase 5 Sprint I completed-page UI/UX alignment as complete.
12. Treat Phase 5 Sprint J/K/L/M/N Location and Access hardening as open:
   keep the implemented migrations, scoped API/WebSocket reads, scoped UI
   guards, location dashboard work, simulator focus settings, telemetry
   index, and collapsible shell, and do not call the sprint complete until
   a clean migration/seed run, Keycloak realm verification, automated access
   tests, and page-wise role walkthrough are done.
13. Defer MinIO/object storage until persisted report files are actually
   needed.
14. Plan Phase 6 as Three.js Control Room only.
15. Keep general AI Copilot / chatbot out of scope for site navigation. The
   **scoped AI onboarding wizard** (admin ingestion only, ADR 0011) is merged
   to `main` and in scope.
16. Treat the **hierarchical master-data admin** (ADR 0008–0010) as in scope:
   Organization → Location → RTU → Asset → Point Key CRUD under `/admin/*`
   with `admin`, `organization_admin`, and `location_admin` roles. Org-level
   read RBAC and hard deletes remain out of scope (deactivate/reactivate only).
17. Treat the **PHE MQTT real-ingestion pilot** (ADR 0007, 0012) as in scope
   for the single pilot RTU only via `apps/ingest`. EMQX and non-MQTT protocol
   adapters remain deferred; the simulator stays the source for all other
   assets.

The completed prototype screens are:

1. **Login** — simple JWT
2. **Executive Dashboard** — live KPIs + trend chart
3. **Alarm Centre** — live alarms + ack
4. **World Map** — Eskom stations + SMOC campuses on Leaflet
5. **Electrical SLD** — animated single-line diagram with live power flow
6. **CRAC / Cooling** — animated HVAC schematic, supply/return temps,
   chilled-water loop, fan speeds
7. **Energy Centre** — energy KPIs, source mix, peak demand, top
   consumers (charts only, no schematic)

Everything else from the mockup or production north star is out of scope
until the corresponding add-on phase begins (see §6).

Rationale for the seven-screen scope is captured in `docs/decisions.md`
entry **D-0001**.

---

## 2. Stack (active)

| Layer        | Technology |
|--------------|------------|
| Frontend     | React 18, TypeScript 5, Vite, Tailwind CSS, TanStack Query, Zustand, React Router, Leaflet, ECharts |
| Backend API  | NestJS (Node 20 LTS, TypeScript) |
| Realtime     | NestJS WebSocket gateway over Socket.IO with Redis adapter when `REDIS_URL` is set |
| Auth         | Keycloak/OIDC for pilot compose; local JWT fallback only for native WSL development |
| Observability | Optional Prometheus, Grafana, Loki, Promtail, and OpenTelemetry baseline |
| OLTP DB      | PostgreSQL 16 |
| Telemetry DB | TimescaleDB extension on the same Postgres |
| Migrations   | Drizzle ORM for tables; raw SQL for one Timescale hypertable |
| Simulator    | Node script in `apps/sim` generating fake meter + sensor values |
| Real ingestion | `apps/ingest` MQTT TLS subscriber for the PHE pilot; writes `telemetry.point_values` and `pg_notify('bms_telemetry', …)` like the simulator (ADR 0007). One pilot RTU only; no EMQX. **Two entry points during the ADR 0016 §6 strangler migration**: `pnpm start` still runs the frozen legacy `src/index.js`, `pnpm start:host` runs the adapter host — and since the §6 commit 3 **cutover on 2026-08-06 the host is what compose runs and what the pilot runs**. The `command:` override in `docker-compose.yml` is the whole of it, so reverting is deleting one line — though it costs the same one-message gap the cutover did, because the container is recreated either way, and a pilot back on `pnpm start` loses `network_strength` every minute. The host still *defaults* `INGEST_NOTIFY=off`, which was the safe direction while two processes ran; with the host serving alone that default is the dangerous one and compose's `INGEST_NOTIFY: "on"` is the only thing keeping realtime alive. See [`docs/ingest-host.md`](./docs/ingest-host.md) |
| Master data  | Organization → Location → RTU → Asset → Point-key catalog + `/admin/*` CRUD with `admin`/`organization_admin`/`location_admin` roles (ADR 0008–0010). **ADR 0018** separates the axes: an asset must have a `location_id` (`NOT NULL`) and need not have an `rtu_id` (nullable); telemetry provenance binds at `asset_points.source_kind` (`measured`/`manual`/`computed`/`unmapped`), not at the asset |
| Asset templates | `bms.asset_templates` + `bms.template_points`, where a row **is** a version and `assets.template_id` pins it (ADR 0015). Published versions are immutable; editing one creates the next draft. `POST /admin/asset-templates/:id/instantiate` builds assets from a published version — target is `rtuId` **xor** `locationId`. A `template_points.kind = 'derived'` point is still re-validated against the active catalog, but never becomes an `asset_points` row — it has no honest `source_data_key` until the calc engine (`F2.6`) owns it |
| Template content | `asset_templates.content` carries the `E1.7` overlay under **ADR 0019**, tiered by whether a consumer exists on `main`. **Bound** (`alarms`, `maintenance`) import their enums from `rules.schema.ts` / `maintenance.schema.ts` — never restate them. **`alarms.philosophy` is the exception inside that row: Anchored, not Bound.** `E2.1` owns its vocabulary and is unbuilt, so its four fields may still be renamed or restructured, and its other three — affected assets, energy/water/production impact, ETR — are properties of a *live alarm instance* and must not be added to a template. **Anchored** (`kpis`, `dashboards`) check point-key references while leaving bodies opaque: `expression` sits behind `dialect: "unvalidated"` until `F2.3`, and a dashboard view carries *ordered point keys only* until `F3.1`. **Reserved** (`health`, `optimisation`) are **rejected**, each naming its blocking item. Every referenced point key must be one the template declares — checked on create, update and publish, because `content` and `points` are patched independently and a points patch can orphan content the request never mentioned. `POST :id/draft` is deliberately **exempt**: it byte-copies stored content, and validating it would strand a pre-ADR template behind its own immutable published version. Nothing converts this into a running rule or a maintenance row; it is the authoring surface only |
| Ingest adapters | `IngestAdapter` interface frozen by **ADR 0016**: the host owns *supervision and cadence* (poll loop, overlap guard, backoff, jitter, bounded queue, process lifetime); adapters own the protocol connection and parse, implementing `connect` / `disconnect` / `health`. **The host is now built** (§6 commit 2): `apps/ingest/src/host/` supplies the supervisor, backoff, bounded queue, binding plan, normaliser and health endpoint, `src/main.ts` is wiring only, and `src/adapters/mqtt.ts` ports the pilot's MQTT connection onto the interface behind `src/adapter/registry.ts` — a port that now **deliberately diverges** from `index.js` in three ways, listed in `docs/ingest-host.md`, because `index.js` is frozen and a defect found in the shared parse logic can only be fixed on the host side. **MQTT is the only implementation, and it is not new scope** — ADR 0007 promoted it, this moves it onto the frozen interface. Modbus, BACnet, OPC-UA, SNMP, REST polling and DCS each still need **their own ADR** under §10 — unconditionally, not only where a protocol library has to be settled under §9.4; see §6. Adapters never read `process.env` (ADR 0016 §4); the host reads it in `host/config.ts`, **plus** the pilot-era `MQTT_*` and `CREDENTIAL_ENCRYPTION_KEY` reads in the unmodified `rtu-config.js`. That `MQTT_USERNAME`/`MQTT_PASSWORD` fallback is the *only* working credential path, and ADR 0016 Resolved decision 5 expected it to **survive cutover**. **It did, and the expectation is no longer a prediction:** the pilot has run on that path since 2026-08-06, `bms.rtu_connection_configs` held no rows when the cutover ran, and the decision's own caveat — that the emptiness was measured on a local seeded database and needed confirming against the production pilot — is discharged by that database *being* the pilot's. Treat the emptiness as a **measurement with a date, not a standing fact**: the onboarding wizard writes that table, so re-query before relying on it. ADR 0016 itself still carries decision 5 unamended, and **the ADR is the authoritative record — this file is only the index** (§10.1); an Amendment 3 recording the discharge is owed and human-gated. Writing an `rtu_connection_configs` row is still prerequisite work for anyone who wants the ADR 0012 path. Amendment 1 widens the schema fields to `ZodType<T, ZodTypeDef, unknown>` so `.default()`/`.transform()` schemas compile; Amendment 2 adds `@types/pg`. **§6 commit 3 is discharged** — the parallel run and the cutover both ran against the live PHE feed on 2026-08-06, and the "not reproducible locally" this row used to claim was wrong. **Still owed: commit 4**, which deletes `src/index.js` and the `INGEST_NOTIFY` flag and **has no named owner** (ADR 0016 Resolved decision 4). It is no longer tidying up: post-cutover the flag's default is the dangerous direction, so commit 4 is what removes a live failure mode |
| AI onboarding | Scoped admin ingestion wizard using OpenAI chat completions with structured JSON, and a deterministic rule-based fallback when `OPENAI_API_KEY` is unset (ADR 0011). **Credentials never transit the chat** (**ADR 0022**, `E8.3`): they arrive through `POST /api/v1/admin/onboarding/sessions/:id/credentials`, and a chat turn that appears to carry one is **refused — not parsed, not stored, not forwarded to the model**. The wizard used to *prompt* for them and parse them out of the turn, which left plaintext in `onboarding_sessions.messages`; migration `0026` purges that column on every existing row (session rows are kept — `audit_log` references them by id). The detector that spots a credential-bearing turn is a **nudge, not the control** — six review rounds found it simultaneously too narrow and too broad, and its documented misses are asserted as tests. The control is that credentials have a typed home. Do not "improve" that detector without reading ADR 0022's amendments first |
| Secrets      | AES-256-GCM encrypted RTU connection credentials via `CREDENTIAL_ENCRYPTION_KEY`; never returned decrypted by the API (ADR 0012). Writers into that store: the master-data RTU admin, and the onboarding credentials endpoint above (**ADR 0022**), which **fails closed** with 503 when the key is unset rather than reporting a success that stored nothing. In an onboarding draft the blob is keyed by **RTU `code`, never by array position** — the draft's `rtus` array is replaced wholesale by any patch, so a positional key delivered one broker's password into a different broker's connection config. A code claimed by no RTU, or by more than one, drops rather than guesses |
| Operations   | Work orders, maintenance schedules, basic rules, Energy CSV reports, completed 2D Control Room foundation screens, completed guided rule builder, and completed Control Room extension. Every mutating endpoint across these four domains is gated by the **operations write matrix** (ADR 0017) — see §4.7 |
| Audit read   | `bms.audit_log` becomes readable under **ADR 0021** (`F4.14`): `GET /api/v1/admin/audit` and `/audit/export` (CSV + XLSX), in `apps/api/src/admin/audit/`. **Global admin only** — the table has no tenancy column, so §4.7's scope predicates cannot be applied to it at all; scoped reads for `organization_admin` and below are **deferred to their own ADR**, not silently omitted. Purely additive: no DDL, no trigger, no new package (`xlsx` was already an api dependency). `payload` is returned **verbatim**, which makes every `payload: body` call site a security surface — see §4.7. Export requires a `from`/`to` window of ≤366 days and is capped at 50,000 rows, **refusing rather than truncating**; the cap was measured, not assumed, and is a *row* bound with **no byte bound** — that gap is recorded in ADR 0021, not fixed. Append-only storage and hash-chaining are `F4.15` and stay out of scope (§6) |
| Containers   | Dockerfiles and Docker Compose profiles for API, web, simulator, **ingest** and DB |
| CI/CD        | GitHub Actions: install, build/typecheck, `typecheck:tests`, **the `apps/ingest` image build**, migration validation, **`db:seed` against a fresh schema**, and `test:coverage` (ADR 0014). The image build is there because no workflow built one, so `apps/ingest/Dockerfile` sat broken on `main` while CI stayed green — it is the only ingest image gated, being the only one that installs before COPYing sources |
| Testing      | Vitest, one project per app + a repo-wide `repo` project; coverage gate on a ratcheting baseline (ADR 0014). See §4.6 |
| Cache / pub-sub | Redis 7 for Socket.IO adapter fan-out |
| Local dev    | WSL2 Ubuntu 22.04; native Postgres remains supported, Docker Compose is optional |

No new dependencies may be added without an ADR in `docs/adr/`.

---

## 3. Repository Layout

```
bms/
├── AGENTS.md                  ← this file (active)
├── CLAUDE.md                  ← pointer to this file for AI agents
├── README.md
├── ESKOM_SMOC.html            ← UX reference (do not edit)
├── TRINETRA.html              ← UX reference, current branding (do not edit)
├── package.json               ← pnpm workspace root
├── pnpm-workspace.yaml
├── vitest.config.ts           ← root test config + coverage ratchet (ADR 0014)
├── docker-compose.yml         ← Phase 1 local/pilot compose entrypoint
├── .github/
│   └── workflows/             ← GitHub Actions CI
├── .claude/
│   ├── agents/                ← review subagents (security, migration, compliance)
│   ├── hooks/                 ← guards, incl. the drizzle journal check
│   └── skills/                ← repo workflows (new-adr, backlog-cycle, verify)
├── tests/                     ← repo-wide invariants; see the §4.6 carve-out
├── exports/                   ← PHE MQTT reference + point-mapping CSVs (ADR 0007/0011)
├── infra/
│   ├── keycloak/              ← Phase 1 Sprint C realm export
│   └── observability/         ← Phase 1 Sprint D Prometheus/Grafana/Loki config
├── apps/
│   ├── web/                   ← React SPA (incl. /admin master-data + onboarding wizard)
│   ├── api/                   ← NestJS REST + WebSocket (incl. src/admin, src/security)
│   │                            src/admin/asset-templates/ holds ADR 0015's
│   │                            lifecycle + instantiation services, and
│   │                            ADR 0019's content contract
│   ├── sim/                   ← telemetry simulator (Node script)
│   └── ingest/                ← PHE MQTT TLS subscriber (ADR 0007), one pilot RTU.
│                                Two entry points during the ADR 0016 strangler:
│                                src/index.js (frozen legacy, what `pnpm start`
│                                runs) and src/host/ + src/adapters/ +
│                                src/main.ts → dist/main.js (`pnpm start:host`,
│                                what compose and the pilot run since the
│                                2026-08-06 §6 commit 3 cutover)
├── packages/
│   ├── shared/                ← cross-cutting TS types & constants
│   └── db/                    ← Drizzle schema, migrations, seeds (incl. phe-catalog.json)
└── docs/
    ├── adr/                   ← Phase 1+ architecture decisions (the live scope record)
    ├── archive/               ← superseded planning docs, kept for provenance
    ├── scripts/               ← docx/report build helpers (not app code)
    ├── security/              ← encryption-at-rest boundary and security notes
    ├── AGENTS.production.md   ← future-state rulebook (reference)
    ├── BACKLOG.md             ← the single managed pending-feature backlog
    ├── build-operating-model.md ← how we build: the per-feature loop and gates
    ├── decisions.md           ← lightweight ADR log for prototype
    ├── env-inventory.md       ← committed environment variable inventory
    ├── observability-runbook.md ← Sprint D local/pilot health checks
    ├── phase-2-ingestion-readiness.md ← Sprint 0 source readiness workbook
    ├── roadmap.md             ← phase plan (prototype + add-ons)
    ├── windows-vm-docker-deploy.md ← Windows VM + Docker Desktop pilot
    └── local-setup.md         ← WSL + Postgres setup steps
```

Do not add top-level folders without updating this section.

---

## 4. Code Rules (lightweight)

### 4.1 TypeScript
- `strict: true`. No `any`. Use `unknown` and narrow.
- Exported functions get a one-line JSDoc.

### 4.2 React
- Functional components only. One component per file.
- Data fetching via TanStack Query hooks in `apps/web/src/api/`.
- UI state via Zustand stores. No Redux.
- Styling via Tailwind utilities. Inline `style` only for dynamic values.

### 4.3 NestJS
- Module-per-domain: `auth`, `assets`, `alarms`, `telemetry`, `audit`.
- Controllers thin → services do work → repositories touch the DB.
- Validate every DTO with Zod. Never trust input.

### 4.4 SQL (Postgres / TimescaleDB)
- Schema-qualified (`bms.assets`, `telemetry.point_values`).
- Snake_case columns. `TIMESTAMPTZ` everywhere.
- Parameterised queries only.
- Migrations are forward-only. Never edit a merged migration.
- Telemetry table is a Timescale hypertable; `chunk_time_interval = 1 day`.

### 4.5 Style hygiene
- File names: `kebab-case` for files, `PascalCase` for React components.
- No abbreviated domain words (`asset`, not `as`; `alarm`, not `alm`).
- Max **1000 lines per file** in the current phase.
- No `console.log` in committed code; use the shared logger (Pino).
- No emoji in code or commits unless explicitly requested.

### 4.6 Testing (ADR 0014)
- **Runner: Vitest.** `pnpm test` runs everything; `pnpm test:coverage` is what
  CI enforces. Never add a second runner without an ADR (§9.4).
- **Assertions live in `*.spec.ts`; `*.test.ts` is the wrapper that runs them.**
  A `.spec` without its sibling `.test` is dead code — `tests/repo-invariants.test.ts`
  fails the build if you add one. Do not delete the spec to make it pass.
- **Carve-out: the split applies to `apps/**` and `packages/**` only.** Files in
  the top-level `tests/` directory are repo-wide invariants and hold their
  assertions **inline**, with no `.spec` sibling. Giving `repo-invariants.test.ts`
  a `.spec` partner would mean the file enforcing the convention is the one file
  that cannot follow it. Do not "fix" these into the split.
- **Integration suites gate on `DATABASE_URL`, and the gate is asymmetric.** An
  unset `DATABASE_URL` skips locally but **throws under `CI`** — a green CI run
  that silently skipped the database tests asserts nothing. A *set* one is a
  claim that a database exists, so a failed connection fails everywhere rather
  than skipping. Coverage thresholds assume these suites ran.
- New behaviour ships with its test in the same PR. Bug fixes ship with the
  test that would have caught the bug.
- **Coverage is a ratchet, not a target.** Thresholds in `vitest.config.ts` sit
  just below the current measurement; raise them as coverage rises. Never lower
  a threshold to make a build pass, and never use `thresholds.autoUpdate` —
  that converts the gate into a rubber stamp. `docs/AGENTS.production.md` §10's
  80% lines / 70% branches remain the destination, not the current rule.
- A check that CI does not execute is not a gate. When you add a test suite,
  script, or invariant, wire it into `.github/workflows/ci.yml` in the same
  change — this repo has shipped orphaned specs and orphaned migrations before.

### 4.7 Authorization (ADR 0009/0010 master data · ADR 0017 operations)

Two role gates exist and they are **not** interchangeable. Both resolve the
role from **`bms.users`, never from the JWT claim** — a token outlives a
demotion by up to `JWT_TTL`, and in OIDC mode `roleFromClaims` falls back to
`viewer` when realm roles are missing, so reading the claim fails *open* on
demotion and *closed* on a claimless admin token.

**Master data** (`/admin/*`) — scope predicates on `AccessControlService`:
`writableOrganizationIds` / `writableLocationIds` return `null` for the
unrestricted global admin, and an **empty array is a real user with no grants**
who must see nothing. Never treat the two as equivalent.

**Operations write matrix** (ADR 0017) — mutating endpoints across rules,
alarms, work orders and maintenance carry
`assertOperationsWriteRole(jwt, class)` at the top of the handler, **before**
the scope check, so a role rejection never depends on scope resolution. The
class literals are exactly `OperationsWriteClass` in
`apps/api/src/auth/operations-write.ts`:

| Class | What it means | `operator` | `viewer` |
|---|---|:-:|:-:|
| `configuration` | changes what the system *will* do, indefinitely — rule authoring, schedule definition, `rules/evaluate`, `rules/preview` | ❌ | ❌ |
| `operational` | records what *did* happen — alarm ack, work-order lifecycle, converting a due schedule | ✅ | ❌ |

The four admin roles keep exactly what they had; this gate regressed nobody.
`rules/preview` is `configuration` despite looking read-only — it inserts a
`rule_preview` row into `bms.audit_log` on every call. **The gate is additive:
callers must pass this AND the existing scope check.**

Instantiating an asset template is the one place the two systems meet: it needs
template *readability* plus `canManageLocation` on the target, so a location
admin may deploy a published org template without being able to author one
(ADR 0015 §7 as amended). Do not require `canManageTemplate` there — it means
"may author" and is false for exactly that role.

**Audit read** (ADR 0021, `F4.14`) — a **third** gate, reusing neither of the
two above. `bms.audit_log` has no tenancy column, so the master-data scope
predicates cannot apply to it. `AuditAdminService.requireGlobalAdmin` runs two
checks in order: a matching **`bms.users` row must exist**, and only then must
`writableOrganizationIds` be `null`.

**The first check is not redundant — Amendment 1 exists because it was
missing.** `resolveDbUser` deliberately falls back to the JWT claim when no row
matches, so in OIDC mode (what compose and the pilot run) an *unprovisioned*
Keycloak principal holding realm role `admin` resolves to `role: "admin"` and a
`null`, unrestricted scope. Every other `/admin/*` endpoint constrains that with
a second scope check; on audit read the `null` **is** the whole control. Without
the provisioning check the endpoint served the entire log — every organisation,
every verbatim `payload`, every actor email — to anyone the IdP called an admin,
and deleting a user's row would have **escalated** them rather than revoked
them. Reproduced against a real database before the fix. **The fallback itself
is unchanged**: pre-existing, affecting all of `/admin/*`, and recorded against
`F4.10` in `docs/BACKLOG.md` as owing its own ADR. If you add an endpoint whose
only control is an unrestricted scope, it has this problem too.

**Onboarding** (ADR 0022, `E8.3`) — a **fourth** gate. Every onboarding entry
point requires role `admin` or `organization_admin` **plus**
`canManageOrganization` on the session's organisation, and both checks live in
**one place**: `OnboardingService.loadSession` → `assertOnboardingAccess`.

Because it sits there rather than on individual handlers, it covers
`getSession`, `chat`, `patchDraft`, `uploadExcel`, `validate` **and**
`setCredentials` together. That placement is the fix, not an implementation
detail: the read gate was once `canManageOrganization` alone while the write
gate also required the role, so a `location_admin` could read a session they
could never create — and `uploadExcel`, sitting on the weaker gate, let them
write credentials by workbook. **Do not re-narrow this to `getSession`.** If you
add an onboarding handler, route it through `loadSession`; a handler that reads
the session any other way is outside the gate.

**Standing obligation (ADR 0021 decision 6).** `audit_log.payload` stores the
verbatim request body at **twelve** call sites — assets, asset-points,
locations, organizations, point-keys and RTUs, create and update each — and the
read API returns it verbatim. None of those Zod schemas admitted a credential,
password, secret or token field when checked on 2026-08-09. **Adding a
secret-bearing field to any audited request body, or to a schema behind one,
creates an audit-read exposure**, so re-run that check whenever one changes.
The obligation is on the call sites, not on one writer: there are 15
`insert(auditLog)` sites in total and 14 do not go through
`MasterDataAuditService`.

---

## 5. Visual Reference

`ESKOM_SMOC.html` is the UX spec. Match it as strictly as the current
React architecture allows:

- Dark top bar, green nav, left module sidebar, KPI ribbon, dark status bar.
- IBM Plex font family.
- Green accent `#00A651`, status colour palette as defined in the file.
- For every new module, identify the closest original route / renderer
  before implementation (for example `R.mt` for Maintenance Kanban · Work
  Orders, `R.rl` for Rule Engine, `R.rp` for Reports).
- Match the original screen's information architecture first: sidebar
  section, page title, actions, card/table/Kanban layout, status pills,
  counts, and empty/loading/error states.
- If backend scope is smaller than the mockup, keep the same layout
  language and clearly omit only the unavailable controls/data.

Do **not** copy its string-concatenation render style. Build proper typed
React components in `apps/web/src/components/`.

Phase 5 Sprint I completed the dedicated UI/UX revisit pass. Future
completed pages should continue using the shared shell, page header,
card, status pill, and disabled command affordance language introduced in
that sprint. The current shell also includes a collapsible left module
sidebar; keep scoped visibility and active-state behaviour consistent with
`AppShell` when adding new navigation items.

---

## 6. Out of Scope for the Current Sprint

These are intentionally deferred. Do not implement them yet:

- Multi-tenancy, row-level security (org-level read RBAC still deferred)
- MFA / SSO / AD federation
- Real protocol adapters for BACnet, Modbus, SNMP, OPC-UA, REST polling, DCS.
  The **MQTT PHE ingest pilot is promoted for one RTU** (ADR 0007), and **ADR
  0016 is promoted as far as §6 commit 2**: the `IngestAdapter` interface, the
  host that supervises it, and the MQTT adapter ported onto it are all on
  `main`. **That is the whole of what is in scope.** Each *further* protocol
  implementation stays deferred until it has **its own ADR**, which settles the
  protocol library where one is needed (licence, maintenance, transitive
  footprint) under §9.4. A protocol that happens to need no library — a REST
  poller on Node 20's global `fetch`, say — is **not** thereby ungated: the ADR
  is required unconditionally **under §10**, which is what moves scope, with
  §9.4 additionally applying wherever a dependency is involved. The dependency
  question is only one of the things the ADR answers. Nor is a new adapter cheap: it is an
  `apps/ingest/src/adapters/` file, a `registry.ts` key, an `INGEST_PROTOCOLS`
  entry where one is missing, a spec/test pair passing `runAdapterContractTests`
  (ADR 0016 §7) — **and that ADR**. Mechanical ease is not permission
- **ADR 0016 §6 commits 3 and 4 stay human-gated.** Commit 3 was the parallel
  run against the **live PHE pilot** and the cutover that followed it; running
  the host against a production deployment is not made in-scope by the ADR
  having been accepted. Both are done, on 2026-08-06 — the gate being satisfied,
  not removed, and it does not generalise to commit 4. **The record is uneven and
  should be read as it is:** the repository owner explicitly instructed *the
  cutover* (PR #19). The *parallel run* was performed inside a broader "bring the
  pilot up" request that never named §6 commit 3, so nothing in git authorises it
  specifically. It was read-only against a database the same request had just
  populated, which is why it did not read as the gated act — but the gate names
  the whole of commit 3, and an agent should treat "it was part of what I was
  already asked to do" as a weaker warrant than an instruction. Commit 4 deletes
  `src/index.js` and the `INGEST_NOTIFY` flag and **has no named owner** (ADR
  0016 Resolved decision 4), which is a human decision by construction. Do not do
  it unprompted
- Template content sections whose consumer does not exist yet. **ADR 0019
  promoted the content model, and it is deliberately partial** — a section is
  contracted only as far as something on `main` can consume it. **Five** things
  stay closed, one per unbuilt consumer, and each reopens when that item lands:
  - `health` — **rejected** by the validator, not accepted untyped. Needs `E1.1`
  - `optimisation` — likewise **rejected**. Needs `E1.6`
  - `kpis.expression` — an opaque string behind `dialect: "unvalidated"`. Needs
    `F2.3` to freeze formula syntax
  - `dashboards` — **ordered point keys only**; no widget types, no layout, no
    sizes. Needs `F3.1` to define the widget vocabulary
  - `alarms.philosophy` — four free-text fields, and `E2.1` owns the vocabulary.
    Do not add its remaining fields (affected assets,
    energy/water/production impact, ETR): those describe a *live alarm
    instance*, not an asset class, so a template cannot carry them

  Do not widen any of the five to make a domain pack easier to author. That is
  exactly how `E5.1` ends up encoding a shape `F3.1` or `E2.1` contradicts a
  year later, with packs already in the field
- Deploying template content into running objects. ADR 0019 is an **authoring**
  surface. A template alarm does not become a `bms.automation_rules` row (that
  needs `ruleType`/`condition`/`action`, which a template does not carry) and a
  maintenance plan does not become a `bms.maintenance_task_templates` row (its
  `asset_id` is `NOT NULL`). Those wirings are `E2.x`/`F3.x` and `E3.x` work
  respectively, each needing its own ADR
- EMQX broker (PHE pilot connects directly over MQTT TLS; no broker)
- MinIO / object storage
- Two-way commanding with approval workflows
- Audit **hash-chaining and append-only storage** (`F4.15`). `bms.audit_log` is
  now *readable* under ADR 0021, but it is not tamper-evident: nothing prevents
  an in-place update or delete. Whether audit **reads** are themselves audited
  is deliberately left open by ADR 0021 for `F4.15`/`F4.19` — do not settle it
  as a side effect of other work
- Energy reports (PDF / XLSX)
- Complex drag-and-drop node graph rule builders
- Three.js Control Room 3D
- General site-wide AI Copilot / chatbot (the **scoped admin onboarding
  wizard is promoted** via ADR 0011; general copilot remains out of scope)
- NERSA / ISO compliance reports
- Kubernetes production manifests

Docker Compose, Dockerfiles, GitHub Actions CI, Redis-backed Socket.IO
pub/sub, Keycloak/OIDC authentication, and the observability baseline are
now in scope for Phase 1 only. Phase 2 Sprint 0 promoted documentation
and readiness analysis only, then selected Path B because real access is
not available. Redis must not be used for unrelated caching or job queues
until a later promotion. Keycloak is limited to local/pilot OIDC
authentication; MFA, SSO federation, and advanced identity governance
remain out of scope. Observability is limited to optional local/pilot
diagnostics. Protocol *brokers* remain out of scope; protocol *adapters* are
governed by the bullet above (ADR 0016 interface, host and MQTT adapter
promoted; each further implementation still ADR-gated) — that bullet supersedes
this sentence. Work-order UI is
complete for Phase 5 Sprint B. Phase 5
Sprint C Maintenance Schedule Centre is complete. Phase 5 Sprint D basic
rule-engine UI is complete for simple threshold/time-window rules,
enable/disable controls, manual evaluation, and execution history. Phase 5
Sprint E Energy report preview and CSV export are complete. Phase 5 Sprint
G 2D Control Room foundation is complete for CR Main Dashboard, CR
Electrical SLD, and CR IT & Rack Load. Phase 5 Sprint H guided visual rule
builder is complete for simple threshold/time-window rule creation, draft
preview, publish, archive, duplicate, enable/disable, preview, and audit
history. The Phase 5 Control Room extension is complete for CR UPS
Monitoring, Battery Bank, HVAC System, Environment, and Dashboard
integration only. Phase 5 Sprint I UI/UX alignment is complete for all
completed pages and did not add backend contracts. Phase 5 Sprint J/K/L/M/N
Location and Access hardening is open: canonical locations, scoped users,
scoped REST/WebSocket reads, live-location dashboard markers, schematic
guards, Control Room asset-group UI gating, simulator focus settings, and
the telemetry dashboard index may remain, but the sprint is not complete
until the hardening checklist in `docs/roadmap.md` is finished. Report PDF/XLSX
output (the *reports* domain — audit-log CSV/XLSX export is a different surface
and **is** in scope under ADR 0021), persisted report storage, CR
Security, CR Alarm Management, CR Trends, Phase 6 3D, two-way commands,
setpoint changes, manual bypass, battery tests, equalize charge, HVAC
force-changeover, sensor calibration/test execution, real-ingestion rules,
scheduler/job queues, and complex node graph builders remain out of scope
until their specific sprint is promoted. General site-wide AI Copilot /
chatbot remains deferred, but the scoped admin onboarding wizard (ADR 0011),
the hierarchical master-data admin (ADR 0008–0010), and the single-RTU PHE
MQTT ingest pilot (ADR 0007, 0012) are promoted and in scope.

**Also promoted since, and in scope now** — the SOW-driven backlog
(`docs/BACKLOG.md`) delivered against `docs/build-operating-model.md`:
the Vitest runner and ratcheting coverage gate (ADR 0014, §4.6); asset
templates, versioning and instantiation (ADR 0015, §4.7); the `IngestAdapter`
interface, **its host, and the MQTT adapter** (ADR 0016 §6 commit 2 — no
further protocol); the operations write matrix (ADR 0017, §4.7);
the asset source-axis separation making `assets.rtu_id` nullable while
`location_id` is `NOT NULL` (ADR 0018); and the template content model
(ADR 0019, §2). Application-layer encryption at rest
is in scope (ADR 0012); **full-disk / volume / KMS encryption is a deployer
action and not implementable in this repo**. Object-storage bucket encryption
(`F3.3`, ADR required) and automated encrypted backups (`E8.2`) remain **live
backlog scope** — they are deferred, not cancelled. The boundary itself is
still an open human decision; see `docs/security/encryption-at-rest.md` and
`docs/BACKLOG.md` §5.

When any other item above is needed, follow §10 (Promotion Process).

---

## 7. Definition of Done (Phase 5 Sprint I)

Phase 5 Sprint I is done:

1. Native WSL development and the Phase 1 compose path remain unchanged.
2. `AppShell` uses the completed mockup chrome: dark top bar, green route
   nav, grouped module sidebar, KPI ribbon, and dark status bar.
3. Core prototype pages use consistent headers, KPI/card framing, status
   pills, tables, loading/empty/error states, and route labels.
4. Operations pages for work orders, schedules, rules, and reports align
   with `R.mt`, `R.rl`, and `R.rp` without changing API payloads.
5. Completed Control Room routes align with `R.crOv`, `R.crSld`,
   `R.crIT`, `R.crUps`, `R.crBat`, `R.crHvac`, and `R.crEnv`, including
   `/cr-ups` for CR UPS Monitoring and `/cr-battery` for CR Battery Bank.
6. Disabled/non-commanding controls stay visibly disabled for commands
   that remain out of scope.
7. `docs/demo-script.md` reflects the completed shell, Operations, and
   Control Room demo flow.
8. `pnpm --filter @bms/shared build`, `pnpm --filter web smoke:cr`,
   `pnpm --filter web build`, `pnpm --filter @bms/db build`,
   `pnpm --filter api build`, and `node --check apps/sim/src/index.js`
   pass.

---

## 8. Local Dev Setup

Single source of truth lives in `docs/local-setup.md`. Summary:

1. Windows 11 + WSL2 + Ubuntu 22.04.
2. Inside Ubuntu: install Node 20, pnpm 9, Postgres 16, TimescaleDB.
3. Clone repo into the WSL filesystem (not `/mnt/c/...`).
4. `pnpm install`.
5. `pnpm db:migrate && pnpm db:seed`.
6. Three native terminals:
   - `pnpm --filter api dev`
   - `pnpm --filter web dev`
   - `pnpm --filter sim start`
7. Optional Phase 1 compose profiles, including Keycloak and
   observability, are documented in `README.md`. Windows VM Docker-only
   deployment steps live in `docs/windows-vm-docker-deploy.md`.

No protocol broker yet. Just Postgres, Redis for realtime fan-out,
Keycloak for local/pilot OIDC, optional observability services, Node, and
Docker Compose for reproducible development. Phase 2 is **no longer paused**:
the single-RTU PHE MQTT pilot ships in `apps/ingest` (ADR 0007, 0012), and
ADR 0016 froze the adapter interface and — as of §6 commit 2 — shipped the host
that runs it with MQTT ported onto it. What remains gated is each *further
protocol implementation*, per §2 and §6 — not Phase 2 as a whole. Phase 5 Sprint A used the existing API and
database stack only; Sprint B added the Maintenance Kanban UI and
`sort_order` persistence for drag/drop. Sprint C added the Maintenance
Schedule Centre, schedule metadata, history, and work-order conversion.
Phase 5 Sprint J/K/L/M/N Location and Access hardening is open; use
`docs/roadmap.md` as the source for its hardening checklist before adding
new scope-sensitive features.

---

## 9. AI Agent Operating Rules (Current Sprint)

1. **Read this file and the affected source files before editing.**
2. Read `docs/AGENTS.production.md` for context on where the system is
   heading — but do **not** implement later-phase concerns yet.
3. Match the style of existing modules and the closest matching
   `ESKOM_SMOC.html` screen. If these conflict, preserve React/codebase
   architecture but prefer the mockup's user-facing layout and labels.
4. Never add a dependency without an ADR in `docs/adr/`.
5. Never invent file paths or library APIs.
6. Never log secrets, tokens, or full PII payloads. **This includes the
   onboarding chat transcript** (`onboarding_sessions.messages`) — it is user
   free text that once carried pasted broker passwords, and it is scrubbed on
   the way out to the client as well as refused on the way in (ADR 0022).
7. Do not introduce EMQX, MinIO, or any item from §6 without a Promotion
   PR (see §10). Redis is only approved for Socket.IO fan-out; Keycloak is
   only approved for local/pilot OIDC; observability is only approved for
   optional local/pilot diagnostics. Phase 2 may document real-ingestion
   candidates, but it must not implement adapters or brokers until real
   access exists. Phase 5 Sprint A is limited to work order foundation.
   Later Phase 5 and Phase 6 feature work requires sprint promotion before
   implementation.
8. Do not bypass the audit middleware.
9. Do not mass-rename or mass-format unrelated code.
10. Update this file only via a PR prefixed `chore(agents): ...`.

---

## 10. Promotion Process (prototype → production rules)

When an add-on phase begins (e.g. "introduce Keycloak", "wire MQTT
ingestion"):

1. Open a PR titled `chore(agents): promote <section> from production`.
2. Copy the relevant section from `docs/AGENTS.production.md` into this
   file (replacing or extending the current rules).
3. Remove the same item from §6 (Out of Scope).
4. Update `docs/roadmap.md` to mark the phase as active.
5. Land the PR before any feature code for that phase is merged.

This keeps the active rules in lockstep with the codebase and ensures AI
agents are never asked to enforce rules that do not yet apply.

### 10.1 ADR-sourced promotion (how this actually works now)

The five steps above describe promotion from `docs/AGENTS.production.md`.
Most scope now moves a different way — an **ADR** in `docs/adr/` decides it,
and the ADR lands with the feature that motivated it. Two consequences, both
recorded here because the practice had diverged from the written process
silently:

- **A promotion may originate from an ADR** rather than from
  `docs/AGENTS.production.md`. Step 2 is then "summarise the ADR's decision
  here and link it", not a copy. The ADR remains the authoritative record;
  this file is the index.
- **Step 5 is inverted for ADR-sourced promotion, by construction.** The ADR
  is written and accepted *before* the feature (that is the §9.4/§10 gate),
  but the `chore(agents):` edit to this file cannot ride along in the feature
  PR — §9.10 forbids it. So the rulebook edit necessarily lands *after* the
  feature. It is discharged by a catch-up `chore(agents):` sweep, and what
  is owed is tracked in `docs/BACKLOG.md` §5 until it lands.

Step 5 still holds for `AGENTS.production.md`-sourced promotions, where no
ADR gate precedes the feature. **The gate that must never be skipped is the
ADR itself, not the bookkeeping in this file.**

**One owed promotion per `chore(agents):` PR.** Batching several into one
sweep makes the diff harder to review precisely when it is the rulebook being
changed, and §9.10's wording does not clearly permit it. If a batch is ever
warranted, ask first — it is not the default and not an agent's call.

---

## 11. Glossary (short)

- **SMOC** — Smart Metering Operating Centre (RSMOC / CSMOC: regional /
  central variants used in seeded location names).
- **BMS** — Building Management System.
- **SLD** — Single-Line (electrical) Diagram.
- **CRAC** — Computer Room Air Conditioner.
- **PUE** — Power Usage Effectiveness.
- **RTU** — Remote Terminal Unit; ingestion source under a location
  (`bms.rtus`). PHE RTUs are physical; Eskom RTUs are synthetic per-domain.
- **PHE / PHEWB** — West Bengal Public Health Engineering; the real MQTT
  ingest pilot source (pump houses via ThinkIoT).

Full glossary lives in `docs/AGENTS.production.md`.

---

## 12. Living Document

This file evolves with the system. Every sprint exit reviews `AGENTS.md`
for accuracy. Every promotion PR updates it.
