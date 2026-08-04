# TRINETRA BMS — Pending Feature List (Northstar Delta)

**Generated:** 2026-07-20
**Purpose:** A single, reconciled list of what remains to be built, derived by
comparing the assessment documents against the production **north star**
(`docs/AGENTS.production.md`).
**Companion inputs:**
[platform-assessment-consolidated.md](./platform-assessment-consolidated.md) ·
[client-requirements-as-is-report.md](./client-requirements-as-is-report.md) ·
[zoho-iot-gap-analysis.md](./zoho-iot-gap-analysis.md) ·
north star [AGENTS.production.md](./AGENTS.production.md)

> **2026-08-04 update:** the Ion Exchange **Enterprise EMS SOW** adds a further
> layer of scope (AI/ML, water domain, maintenance depth, sustainability,
> multi-tenant/edge deployment) on top of this list. Those additional features
> live in [sow-ems-pending-features.md](./sow-ems-pending-features.md) with
> `E<x>.<n>` ids and their own sequencing/dependency map.

---

## How this list was built (read first)

This is **not** a re-statement of the phase roadmap in
`platform-assessment-consolidated.md`. It is the **union** of every open item
across the three benchmarks, re-checked against `main`, using the north star as
the organizing lens. Two corrections were applied so statuses are trustworthy:

1. **The assessment docs (dated 2026-06-27) understate recent progress.** Each
   "missing/partial" claim was spot-checked against `main` (latest commit
   `f50075d`). Where the code now says otherwise, the row is corrected.
2. **The north star is a target, not current law.** Per `CLAUDE.md`'s
   precedence rule, ADRs win on scope. North-star sections that a later ADR
   decided **differently** are listed in §5 (Superseded) — they are *not*
   pending. North-star sections that are simply *not built yet* are pending.

**Provenance column:** `✓ main` = status verified against the codebase in this
pass; `~ doc` = carried from the assessment docs, not re-verified this pass.

**Status legend:** ❌ Missing · ⚠ Partial · **P** = Priority (P0 blocks the
client MVP; P1 high; P2 medium; P3 low) · effort in person-weeks (pw).

**Two benchmarks, one priority rule:** *client requirements outrank both Zoho
parity and north-star completeness when they conflict.* North-star hardening
(§4 here) is real work but must not jump the queue ahead of a P0 client feature.

---

## 1. Data Connectivity & Ingestion  *(client req 1, 3 — highest client priority)*

| Feature | Status | Source | Prov. | P | Effort |
|---------|--------|--------|-------|---|--------|
| Ingest adapter framework (`IngestAdapter` interface, pluggable) | ❌ | north star §7, client 1 | ✓ main | P0 | 4–5 |
| Modbus TCP/RTU adapter | ❌ | north star §2, client 1, Zoho | ✓ main | P0 | 10–12 |
| BACnet/IP read adapter | ❌ | north star §2, client 1 | ✓ main | P0 | 10–12 |
| OPC-UA subscription adapter | ❌ | north star §2, client 1 | ✓ main | P1 | 10–14 |
| SNMP + REST poller adapters | ❌ | north star §2 | ✓ main | P1 | 8–10 |
| DCS / SCADA / PLC connector (client-specific) | ❌ | client 1 | ~ doc | P0 | 8–12 |
| Expand MQTT ingest beyond the single PHE RTU (feature-flagged) | ⚠ | ADR 0007, client 1 | ✓ main | P0 | 3–4 |
| Manual time-series entry API + UI | ❌ | client 3 | ✓ main | P0 | 2–3 |
| Telemetry **history** bulk import (CSV/Excel) | ❌ | client 3 | ✓ main | P0 | 3–4 |
| Adapter backpressure: broker-disconnect backoff + 1 h disk buffer | ❌ | north star §7 | ✓ main | P1 | 3–4 |
| Ingest normaliser is the *only* writer to `telemetry.*` (formalise) | ⚠ | north star §7 | ~ doc | P2 | 2 |

> **Note on Excel:** Excel import **exists** (`onboarding-excel.service.ts`) but
> only for **master-data onboarding** and energy-report export — it does **not**
> ingest telemetry history. Client req 3 remains open.

---

## 2. Data Model, Templates & Calculations  *(client req 5, 6, 7, 9)*

| Feature | Status | Source | Prov. | P | Effort |
|---------|--------|--------|-------|---|--------|
| Asset template schema (`asset_templates` + `template_points`) | ❌ | client 5 | ✓ main | P0 | 10–12 |
| Instantiate assets from template (model-once-deploy-many) | ❌ | client 5, Zoho | ✓ main | P0 | 4–5 |
| Calculation formula DSL + definition schema (`calculations`, `calc_inputs`) | ❌ | client 7, 9 | ✓ main | P0 | 8–10 |
| Calc execution engine (streaming + scheduled) | ❌ | client 7, 9 | ✓ main | P0 | included above |
| Calculation configuration UI | ❌ | client 9 | ✓ main | P0 | 4–5 |
| Template calc-tags wired into the calc engine | ❌ | client 5, 7 | ✓ main | P0 | 3–4 |
| Tag-mapping bulk editor + Excel mapping sheet | ⚠ | client 6 | ~ doc | P1 | 4–5 |
| Replace hardcoded PUE SQL with user-defined derived tags | ⚠ | client 7 | ~ doc | P1 | (in calc engine) |

---

## 3. Platform Features  *(Zoho parity + north-star product surfaces)*

### 3a. Dashboards, Storage & Reporting

| Feature | Status | Source | Prov. | P | Effort |
|---------|--------|--------|-------|---|--------|
| Configurable dashboard definition schema + builder UI (core widgets) | ❌ | client 8, Zoho | ✓ main | P0 | 14–18 |
| Per-asset-type default dashboards from template | ❌ | client 8 | ✓ main | P1 | 3–4 |
| Object storage (MinIO/S3) + `asset_images` metadata | ❌ | client 2, north star §2 | ✓ main | P1 | 8–12 |
| Image upload API + asset linkage | ❌ | client 2 | ✓ main | P1 | (with above) |
| Scheduled PDF / Excel energy reports | ❌ | Zoho, north star §5 | ✓ main | P2 | 4–6 |

### 3b. Alarms, Rules, Notifications & Commanding

| Feature | Status | Source | Prov. | P | Effort |
|---------|--------|--------|-------|---|--------|
| **Unify alarm engine** — merge hardcoded `AlarmThresholdService` into DB-driven rules | ⚠ | Zoho, ops | ✓ main | P0 | 4–6 |
| **Execute** rule actions (rules store `notify` but never fire) | ⚠ | Zoho, ops | ✓ main | P0 | (with notifications) |
| Email + webhook notification service (`notification_profiles`, `notification_log`) | ❌ | Zoho, north star §5 | ✓ main | P0 | 4–6 |
| SMS / push channels | ❌ | Zoho | ✓ main | P2 | 3–4 |
| Alarm escalation profiles + auto-clear on normal | ❌ | Zoho | ~ doc | P1 | 4–6 |
| Scheduled / cron rule evaluation (BullMQ workers) | ❌ | north star §2, Zoho | ✓ main | P1 | 4 |
| **Two-way command path**: `commands` + `command_results`, queue + MQTT downlink | ❌ | north star §5/§8, Zoho | ✓ main | P1 | 8–10 |
| Command **safety gate** (interlocks, time windows, role limits) | ❌ | north star §8 | ✓ main | P1 | (with commands) |
| Dual-approval workflow for `requires_approval` assets | ❌ | north star §8 | ✓ main | P1 | 3–4 |

### 3c. Device / Gateway Lifecycle

| Feature | Status | Source | Prov. | P | Effort |
|---------|--------|--------|-------|---|--------|
| Device / asset / RTU CRUD APIs (beyond admin/onboarding) | ⚠ | Zoho, north star §6 | ✓ main | P1 | 4–6 |
| Device health / last-seen / heartbeat (`device_health`, `last_seen_at`) | ❌ | client 1/4, Zoho | ✓ main | P1 | 3–4 |
| OTA firmware module | ❌ | Zoho | ~ doc | P3 | 10+ |
| X.509 device certificate management | ❌ | Zoho | ~ doc | P2 | — |
| 3D control room (Three.js) | ❌ | north star §2 (AGENTS.md §6 defers) | ✓ main | P3 | — |
| Mobile PWA / responsive ops app | ❌ | Zoho, north star §12 | ~ doc | P2 | 16+ |

### 3d. Guided Onboarding Agent  *(client onboarding — user explicitly requested)*

A true **agentic onboarding assistant** (not just a chatbot) that walks a user
through onboarding by asking simple questions and **actually creating** the
records for them: **locations, asset templates, assets, parameters (point
keys), asset tags, and their mappings** — including protocol-based device
setup.

**What exists today (baseline):** `onboarding-chat.service.ts` is a phased
**draft-builder** chatbot (location → rtu → point_keys → assets → mappings →
review). Its LLM path (`handleOpenAiTurn`) is a **single-shot JSON producer**;
its no-key fallback (`handleRuleBasedTurn`) is scripted. It accumulates a draft
blob and a **separate commit** step writes everything at once. It has **no
asset-template concept** and does not perform incremental create actions.

**Delta to build (this feature):**

| Feature | Status | Source | Prov. | P | Effort |
|---------|--------|--------|-------|---|--------|
| Tool-calling agent loop (function/tool calls that invoke real create APIs, not a single-shot JSON draft) | ⚠ | client onboarding | ✓ main | P0 | 5–7 |
| Agent onboards **asset templates** (create + instantiate) conversationally | ❌ | client onboarding, client 5 | ✓ main | P0 | 4–5 *(needs §2 templates)* |
| Agent onboards **parameters (point keys) + asset tags** and **maps** source keys ↔ tags via Q&A | ⚠ | client onboarding, client 6 | ✓ main | P0 | 3–4 |
| Agent drives **protocol-based** device onboarding (discover/prompt per adapter: Modbus/BACnet/OPC-UA/MQTT) | ⚠ | client onboarding, client 1 | ✓ main | P1 | 3–4 *(needs §1 adapters)* |
| Interactive, question-driven UX with per-step confirm + rollback (beyond current all-at-once commit) | ⚠ | client onboarding | ✓ main | P1 | 3–4 |
| Agent grounding on org catalog/templates/protocols (retrieval context, not hardcoded scripts) | ⚠ | client onboarding | ✓ main | P1 | 2–3 |
| Deterministic rule-based fallback parity when no LLM key is set | ⚠ | client onboarding | ✓ main | P2 | 2–3 |

> **Depends on:** §2 asset templates (blocks template onboarding) and §1
> adapter framework (blocks protocol discovery). Sequence this **after**
> templates land, reusing the existing draft/commit + credential-encryption
> plumbing rather than replacing it.

---

## 4. Non-Functional / Production Hardening  *(north star — currently invisible gaps)*

These are not "features" the client listed, but the north star mandates them for
production. Several are **large and currently unrepresented in any roadmap**, so
they are called out explicitly.

### 4a. Telemetry Scale (north star §4.5)

| Item | Status | Prov. | P | Effort |
|------|--------|-------|---|--------|
| Continuous aggregates (`point_values_1m/_5m/_1h/_1d`) | ❌ | ✓ main | P0 | 4–5 |
| Retention policy (`compress_after 7d`, `drop_after 2y`) | ❌ | ✓ main | P0 | (with above) |
| Raw-message archive + ingest diagnostics (dead-letter) | ❌ | ✓ main | P2 | 3 |

### 4b. Test Infrastructure (north star §10) — **biggest hidden gap**

| Item | Status | Prov. | P | Effort |
|------|--------|-------|---|--------|
| Real test runner — repo has **only `tsx` specs**, no Vitest/Jest | ❌ | ✓ main | P0 | 4–6 |
| **Wire the test run into CI** — add a `test` step/job to `.github/workflows/ci.yml` (today it only runs `typecheck` + `db:migrate`; the existing `pnpm test:onboarding` suite is **never executed on PRs**) | ❌ | ✓ main | P0 | (with runner) |
| Integration tests w/ testcontainers (Postgres + Timescale + Redis) | ❌ | ✓ main | P1 | 6–8 |
| Contract tests (API ↔ web via `packages/contracts` Zod) | ❌ | ✓ main | P1 | (with contracts) |
| E2E (Playwright) for critical `ESKOM_SMOC.html` paths | ❌ | ✓ main | P1 | 4–6 |
| Load tests (k6): 5,000 meters @ 1 Hz, 1,000 concurrent users | ❌ | ✓ main | P2 | 3–4 |
| Coverage gates (80% line / 95% for command·alarm·audit·RBAC) | ❌ | ✓ main | P1 | (CI wiring) |
| Automated access-control integration tests | ❌ | ✓ main | P0 | 3 |

> **F4.4 scope note — CI integration is part of the runner story.** The runner
> is only a real gate once CI *runs* it. Existing CI
> ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) is **build +
> migration-validation only** — one `build-and-migrate` job doing `pnpm
> typecheck` and `pnpm db:migrate` against a Timescale service container, with
> **no test, lint, or coverage step**. F4.4 must: (1) stand up the runner
> (Vitest/Jest), (2) migrate the current `tsx` specs onto it, and (3) **add a
> `test` step to `ci.yml` so PRs fail on a red test** — the precondition that
> lets subagent output be trusted without line-by-line review
> ([build-operating-model.md](./build-operating-model.md) §4–5). Coverage gates
> (row above) layer on afterwards.

### 4c. Security & Governance (north star §9)

| Item | Status | Prov. | P | Effort |
|------|--------|-------|---|--------|
| Fix operator/viewer RBAC — default read scope (zero assets today) | ⚠ | ✓ main | P0 | 2 |
| Disable local-JWT fallback when `OIDC_ISSUER` set | ⚠ | ~ doc | P0 | 1 |
| Keycloak MFA on the pilot realm | ❌ | ~ doc | P1 | 2 |
| Audit **read** API + export (write path exists) | ❌ | ✓ main | P1 | 2–3 |
| Append-only audit + nightly **hash-chaining** | ❌ | ✓ main | P2 | 3–4 |
| Row-level security on cross-tenant tables | ❌ | ✓ main | P2 | 4–6 |
| API rate limiting (`@nestjs/throttler` / Traefik) + service-account tokens | ❌ | ✓ main | P1 | 3–4 |
| mTLS for inter-service traffic | ❌ | ~ doc | P2 | — |
| OWASP ASVS L2 (L3 for command/audit), NERSA / ISO 50001 alignment | ❌ | ~ doc | P2 | compliance track |

### 4d. API, Observability & Delivery (north star §6, §11–14)

| Item | Status | Prov. | P | Effort |
|------|--------|-------|---|--------|
| OpenAPI / Swagger for all `/api/v1` routes | ❌ | ✓ main | P0 | 2–3 |
| RFC 7807 error envelope + `correlation_id` + `Idempotency-Key` | ❌ | ✓ main | P1 | 3–4 |
| Cursor pagination on hot list endpoints (assets, telemetry) | ⚠ | ~ doc | P2 | 2 |
| `packages/contracts` (shared Zod API contracts), `packages/ui`, `telemetry-sdk` | ❌ | ✓ main | P2 | 6–8 |
| `apps/worker` (BullMQ jobs), EMQX broker, Traefik, MinIO in the stack | ❌ | ✓ main | P2 | infra track |
| SLO instrumentation (API p95<250ms, alarm p99<2s, command p99<3s) | ❌ | ✓ main | P2 | 3 |
| Frontend perf budgets (≤250 kB gzip, LCP≤2.5 s, route lazy-load) | ⚠ | ~ doc | P3 | 2 |
| Kubernetes prod deploy + HA (Postgres replica, Redis Sentinel) | ❌ | north star §2, ~ doc | P1 | 8–12 |

---

## 5. Superseded / Decided-Differently — **NOT pending**

Listed so no one re-opens a settled decision as a "gap."

| North-star item | Superseded by | Reality |
|-----------------|---------------|---------|
| §5 hierarchy `Tenant→Site→Building→Floor→Zone` | **ADR 0008** | Implemented as `Organization→Location→RTU→Asset→Point`. Different by design, not missing. |
| §5 `bms.gateways`/`gateway_devices` | ADR 0008 | Realised as `bms.rtus` with `ingest_enabled` / `mqtt_topic`. |
| Multi-tenant MSP / white-label portals | AGENTS.md §6 (deferred) | Location + asset-group scoping is the chosen model for the pilot; full multi-tenancy is out of scope until promoted. **⚠ 2026-08-04: the Ion Exchange EMS SOW §11 re-opens this** — see [sow-ems-pending-features.md](./sow-ems-pending-features.md) E7.1; needs an ADR before it counts as pending. |
| Two-way commanding (as *default* posture) | AGENTS.md §6 | Deferred; listed in §3b as a **future** north-star target, not current scope. Browser realtime stays read-only. |
| §2 `BullMQ`, `EMQX`, `MinIO`, `Three.js`, `shadcn/ui` | AGENTS.md §6 | Genuine future targets (in §3–4 above) but explicitly out of scope on `main` today. |

---

## 6. Suggested Sequencing (client-priority, dependency-aware)

> **Full dependency hierarchy, parallel tracks, waves, and critical path:**
> see [pending-features-sequencing.md](./pending-features-sequencing.md). The
> list below is the narrative summary; that doc is the authoritative ordering.

Ordering follows the assessment's phases but folds in the north-star hardening
that the client roadmap omitted. **P0 client features lead; hardening rides
alongside, not ahead.**

1. **Foundation (P0):** asset templates → template instantiation → manual +
   CSV telemetry import → Timescale retention/aggregates → unified alarm engine
   → email/webhook notifications → OpenAPI → **fix operator RBAC** → **stand up
   a real test runner** (§4b — do this early; everything after depends on it).
2. **Industrial connect (P0/P1):** adapter framework → Modbus → BACnet → OPC-UA
   → DCS connector → device health/last-seen → expand MQTT to all RTUs.
3. **Calc, dashboards & guided onboarding (P0):** calc DSL + engine + config UI
   → dashboard schema + builder → template default dashboards → template
   calc-tags → **guided onboarding agent** (§3d — builds on templates + adapter
   framework; upgrades the existing draft-builder chatbot into a tool-calling
   agent that creates locations, templates, assets, parameters, and mappings).
4. **Governance & scale (P1/P2):** audit read API → RLS → command path + safety
   gate + dual approval → HA deploy → hash-chained audit → SLOs → contracts/ui
   packages → integration/E2E/load tests to coverage gates.
5. **Advanced (P2/P3):** object storage + images → ML anomaly detection →
   vision inference → mobile PWA → OTA.

---

## 7. Follow-ups this list implies

- These are **candidate scope**, not yet approved. Under AGENTS.md §10, any item
  that moves into active scope needs an **ADR** first (new deps — Modbus/BACnet
  libs, `bullmq`, `nodemailer`, `minio`, Vitest — are §9.4-gated).
- When an item is promoted, mirror it into `docs/roadmap.md` and soften the
  matching AGENTS.md §6 line via a separate `chore(agents):` change.
- Effort figures are carried from the assessment docs or estimated for
  north-star-only items; treat them as planning-grade, not commitments.
