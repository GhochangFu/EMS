# Client Requirements — As-Is Feature Report & Gap Effort

**Generated:** 2026-06-27  
**Priority:** Client requirements (below) take precedence over Zoho IoT parity.  
**Companion files:** [client-requirements-matrix.csv](./client-requirements-matrix.csv) · [zoho-iot-gap-analysis.md](./zoho-iot-gap-analysis.md) · [platform-assessment-consolidated.md](./platform-assessment-consolidated.md)

---

## Client Requirements (Source)

1. **Data connect** (SCADA, PLC, DCS, IoT) and rendering to cloud  
2. **Storage:** time-series, images, relational data  
3. **Time-series ingestion:** streaming, manual feed, CSV/Excel upload  
4. **Tags (channels)** on assets (e.g. heat exchanger, cooling tower)  
5. **Asset templates:** assets instantiated from templates; templates define tags (input, output, calculations)  
6. **Tag mapping:** customer tags → system tags  
7. **Calculations:** simple derived (e.g. `C = A + B`), analytics, ML (multivariate time-series), vision  
8. **Dashboards:** configurable charts, widgets, cards  
9. **Calculation setup / configuration**

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Overall client-requirement coverage** | **~38%** |
| **Strongest areas** | Relational master data, tag mapping workflow, streaming telemetry (MQTT pilot), fixed operational dashboards |
| **Weakest areas** | SCADA/PLC/DCS adapters, asset templates, calculations engine, configurable dashboards, image/ML/vision storage |
| **Estimated effort to MVP (items 1–6 + basic 7–9)** | **~95–120 person-weeks** |
| **Estimated effort to full client vision (incl. ML + vision)** | **~155–200 person-weeks** |

The platform has **advanced significantly** since the initial Zoho comparison: hierarchical master-data admin, org-scoped point-key catalog, AI/rule-based onboarding wizard, Excel import for site setup, and encrypted RTU connection config are now implemented. Gaps are concentrated in **industrial protocol adapters**, **asset template engine**, **calculation/ML pipeline**, and **self-service dashboards**.

---

## Existing Technology Stack

Verified from `AGENTS.md`, `package.json`, `docker-compose.yml`, and application manifests.

### Stack overview

| Layer | Technology | Version / notes |
|-------|------------|-----------------|
| **Monorepo** | pnpm workspaces | pnpm 9.15.0 |
| **Language** | TypeScript | 5.7.x (`strict: true`) |
| **Runtime** | Node.js | 20 LTS |
| **Frontend** | React | 18.3 |
| **Build (web)** | Vite | 6.x |
| **Styling** | Tailwind CSS | 3.4 |
| **Client state** | Zustand | 5.x |
| **Data fetching** | TanStack Query | 5.x |
| **Routing** | React Router | 7.x |
| **Charts** | ECharts + echarts-for-react | 5.6 |
| **Maps** | Leaflet + react-leaflet | 1.9 / 4.2 |
| **Backend API** | NestJS | 10.4 |
| **Validation** | Zod | 3.24 |
| **ORM / migrations** | Drizzle ORM + drizzle-kit | 0.38 / 0.30; raw SQL for Timescale hypertable |
| **OLTP database** | PostgreSQL | 16 |
| **Time-series** | TimescaleDB | Extension on same Postgres instance (`chunk_time_interval = 1 day`) |
| **DB driver** | node-postgres (`pg`) | 8.13 |
| **Realtime** | Socket.IO + NestJS WebSocket gateway | 4.8 |
| **Realtime fan-out** | Redis 7 + `@socket.io/redis-adapter` | Horizontal API scaling |
| **Auth (pilot)** | Keycloak OIDC | 24.0 (`infra/keycloak/bms-realm.json`) |
| **Auth (dev fallback)** | JWT + bcrypt | Local WSL native dev only |
| **Logging** | Pino + nestjs-pino | Structured logs |
| **Metrics** | prom-client | `/metrics` on API, sim, ingest |
| **Tracing** | OpenTelemetry (Node SDK) | Optional baseline in API |
| **MQTT ingest** | MQTT.js | 5.10 (`apps/ingest` only) |
| **Excel (onboarding)** | SheetJS (`xlsx`) | API-only; ADR 0013 |
| **AI onboarding** | OpenAI API (optional) | Rule-based fallback when key unset; ADR 0011 |
| **Credential encryption** | AES-256-GCM | RTU secrets; ADR 0012 |
| **CI/CD** | GitHub Actions | Build, typecheck, migration validation |
| **Containers** | Docker + Docker Compose | Multi-profile local/pilot deploy |

### Repository applications

| App / package | Path | Role |
|---------------|------|------|
| **web** | `apps/web` | React SPA — operator dashboards, control room, admin master-data, onboarding wizard |
| **api** | `apps/api` | NestJS REST (`/api/v1`) + WebSocket (`/ws/telemetry`, `/ws/alarms`) |
| **sim** | `apps/sim` | Synthetic telemetry generator → `telemetry.point_values` + `pg_notify` |
| **ingest** | `apps/ingest` | MQTT TLS subscriber (PHE pilot) → same telemetry pipeline |
| **@bms/db** | `packages/db` | Drizzle schema, SQL migrations, seeds, hierarchy verification CLI |
| **@bms/shared** | `packages/shared` | Cross-cutting TypeScript types, point-key constants, DTOs |

### Data pipeline (as deployed)

```
[Simulator] ──┐
              ├──► INSERT telemetry.point_values ──► pg_notify('bms_telemetry')
[MQTT Ingest] ┘              │
                             ▼
              TelemetryNotifyService (LISTEN) ──► TelemetryBroadcastHub
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        Socket.IO WS   AlarmThreshold   (future rules)
              │
              ▼
         React UI (TanStack Query + live WS)
```

### Docker Compose services

| Service | Image / build | Profiles | Port |
|---------|---------------|----------|------|
| `postgres` | `timescale/timescaledb:latest-pg16` | always | 5432 |
| `redis` | `redis:7-alpine` | core, pilot, phe, realtime-smoke | 6379 |
| `keycloak` | `quay.io/keycloak/keycloak:24.0` | core, identity, pilot, phe | 8080 |
| `migrate` | API Dockerfile | core, migrate, sim, pilot, phe | — |
| `api` | `apps/api/Dockerfile` | core, pilot, phe | 4000 |
| `api-replica` | API Dockerfile | realtime-smoke | 4001 |
| `web` | `apps/web/Dockerfile` | core, pilot | 5173 |
| `sim` | `apps/sim/Dockerfile` | sim, pilot | 9101 (metrics) |
| `ingest` | `apps/ingest/Dockerfile` | ingest, pilot, phe | 9102 (metrics) |
| `prometheus` | `prom/prometheus:v2.55.1` | observability | 9090 |
| `loki` | `grafana/loki:3.2.1` | observability | 3100 |
| `promtail` | `grafana/promtail:3.2.1` | observability | — |
| `grafana` | `grafana/grafana:11.3.1` | observability | 3000 |

### Database schemas (relational + time-series)

| Schema | Key tables | Purpose |
|--------|------------|---------|
| `bms` | `organizations`, `locations`, `rtus`, `assets`, `asset_points`, `point_keys` | Master data hierarchy and tag catalog |
| `bms` | `protocol_catalog`, `rtu_connection_configs` | Protocol definitions + encrypted connection config |
| `bms` | `onboarding_sessions` | AI/rule-based onboarding wizard drafts |
| `bms` | `alarms`, `automation_rules`, `rule_executions` | Alarms and rule engine |
| `bms` | `work_orders`, `maintenance_*` | Operations / maintenance |
| `bms` | `users`, `user_*_access` | Auth identities and scoped access |
| `bms` | `audit_log` | Lightweight audit trail (write-only) |
| `telemetry` | `point_values` | Timescale hypertable — all time-series tag values |

### API surface (summary)

| Area | Base path | Auth |
|------|-----------|------|
| Health / metrics | `/health`, `/metrics` | Public |
| Auth | `/api/v1/auth/*` | Login public; `/me` protected |
| Operations | `/api/v1/dashboard`, `/alarms`, `/telemetry`, `/rules`, `/work-orders`, `/maintenance`, `/reports`, `/map`, `/assets` | JWT / OIDC |
| Admin master-data | `/api/v1/admin/organizations`, `/locations`, `/rtus`, `/assets`, `/point-keys`, `/asset-points` | JWT / OIDC + role scope |
| Admin onboarding | `/api/v1/admin/onboarding/*` | JWT / OIDC + org admin |
| WebSocket | `/ws/telemetry`, `/ws/alarms` | Token on connect |

### Protocol connectivity (current)

| Protocol | Status | Component |
|----------|--------|-----------|
| MQTT (TLS) | **Live** (PHE pilot) | `apps/ingest` |
| Simulator | **Live** | `apps/sim` |
| Modbus TCP, BACnet, OPC-UA, SNMP, REST poller | **Config only** | `bms.protocol_catalog`; adapters not wired |
| SCADA / DCS native | **Not implemented** | Client-specific |

### Explicitly deferred (per `AGENTS.md`)

EMQX broker, MinIO/object storage, Kubernetes manifests, multi-protocol edge agents (beyond pilot MQTT), general site AI copilot, mobile apps, OTA firmware, two-way commanding, PDF/XLSX report storage.

### Local development

- **Primary:** WSL2 Ubuntu 22.04, native Postgres 16 + TimescaleDB, three terminals (api, web, sim)
- **Optional:** Docker Compose profiles for Keycloak, Redis, observability, PHE ingest
- **Docs:** `docs/local-setup.md`, `docs/windows-vm-docker-deploy.md`

---

## As-Is vs Client Requirements

### 1. Data Connect (SCADA, PLC, DCS, IoT) → Cloud

| Sub-requirement | As-Is Status | Evidence | Quality | Gap |
|-----------------|--------------|----------|---------|-----|
| IoT (MQTT) live ingest | **Implemented** | `apps/ingest`, PHE pilot (ADR 0007), `bms.rtus` + `rtu_connection_configs` | 6/10 | Expand beyond single pilot RTU |
| Internal simulator | **Implemented** | `apps/sim` → `telemetry.point_values` | 7/10 | — |
| Protocol catalog (SCADA/PLC/DCS types) | **Partial** | `bms.protocol_catalog` — Modbus TCP, BACnet, OPC-UA, SNMP, REST poller defined; **only MQTT `ingest_wired=true`** | 3/10 | Wire adapters |
| SCADA integration | **Missing** | No OPC-UA/BACnet/Modbus runtime adapter | 0/10 | Edge adapter service |
| PLC (Modbus) | **Missing** | Config schema + onboarding only | 0/10 | Modbus TCP/RTU adapter |
| DCS | **Missing** | Not in catalog | 0/10 | Protocol TBD with client |
| Cloud rendering (API + live UI) | **Partial** | NestJS REST + Socket.IO → React SPA; Docker Compose | 6/10 | HA, multi-region |
| Encrypted connection credentials | **Implemented** | ADR 0012, AES-256-GCM on `rtu_connection_configs` | 7/10 | Secrets manager in prod |

**As-is score: 25%**  
**Gap effort: 40–55 pw** (Modbus 10–14, BACnet 10–14, OPC-UA 10–14, DCS TBD 8–12, cloud HA 8–12)

---

### 2. Storage — Time-Series, Images, Relational

| Sub-requirement | As-Is Status | Evidence | Quality | Gap |
|-----------------|--------------|----------|---------|-----|
| Time-series DB | **Implemented** | TimescaleDB hypertable `telemetry.point_values` (1-day chunks) | 7/10 | Retention, compression, aggregates |
| Relational data | **Implemented** | PostgreSQL `bms.*` — orgs, locations, RTUs, assets, mappings, rules, work orders | 7/10 | Asset templates table |
| Image / binary storage | **Missing** | No MinIO/S3; no image tables or upload API | 0/10 | Object storage + metadata schema |
| Raw message archive | **Missing** | Ingest drops unmapped payloads silently | 0/10 | Debug/archive table (optional) |

**As-is score: 55%** (excluding images: 73%)  
**Gap effort: 12–18 pw** (object storage 8–12, retention/aggregates 4–6)

---

### 3. Time-Series Ingestion Modes

| Sub-requirement | As-Is Status | Evidence | Quality | Gap |
|-----------------|--------------|----------|---------|-----|
| Streaming (real-time) | **Implemented** | MQTT ingest, simulator, `pg_notify` → WebSocket | 7/10 | Scale + multi-protocol |
| Manual feed (operator entry) | **Missing** | No UI/API to post point values | 0/10 | Manual entry API + form |
| CSV upload (telemetry) | **Missing** | Energy report CSV is **export only** | 0/10 | Bulk TS import pipeline |
| Excel upload (telemetry) | **Missing** | Excel import is **onboarding master data** only (ADR 0013) | 0/10 | TS Excel template + parser |

**As-is score: 25%**  
**Gap effort: 6–10 pw** (manual API 2–3, CSV import 3–4, Excel TS template 3–4)

---

### 4. Tags (Channels) on Assets

| Sub-requirement | As-Is Status | Evidence | Quality | Gap |
|-----------------|--------------|----------|---------|-----|
| Tag belongs to asset | **Implemented** | `bms.asset_points` per asset; values in `telemetry.point_values` keyed by `(asset_id, point_key)` | 7/10 | Tag type (input/output/calc) |
| System tag catalog | **Implemented** | `bms.point_keys` org-scoped catalog (ADR 0010) | 7/10 | Domain templates linkage |
| Asset types (heat exchanger, etc.) | **Partial** | `assets.domain` (electrical, hvac, …); no equipment-type template | 4/10 | Asset template model |
| Live tag values | **Implemented** | WS `/ws/telemetry` + `GET /telemetry/points/:ref/recent` | 7/10 | Aggregation API |

**As-is score: 70%**  
**Gap effort: 3–5 pw** (tag kinds, equipment taxonomy)

---

### 5. Asset Templates (Instantiate Assets + Tag Definitions)

| Sub-requirement | As-Is Status | Evidence | Quality | Gap |
|-----------------|--------------|----------|---------|-----|
| Asset template entity | **Missing** | No `asset_templates` table; PHE catalog is static JSON seed | 0/10 | Template schema + API |
| Instantiate asset from template | **Missing** | Assets created via admin CRUD or onboarding commit | 0/10 | `POST /assets from template` |
| Template defines input tags | **Missing** | Point keys exist separately; not bundled in template | 0/10 | Template point definitions |
| Template defines output tags | **Missing** | Same | 0/10 | Same |
| Template defines calculation tags | **Missing** | No calc tag concept | 0/10 | Calc definitions on template |
| Model-once-deploy-many | **Missing** | Zoho pattern; not implemented | 0/10 | Template propagation |

**As-is score: 5%** (conceptual overlap via point_keys + manual asset creation)  
**Gap effort: 10–14 pw**

---

### 6. Tag Mapping (Customer → System Tags)

| Sub-requirement | As-Is Status | Evidence | Quality | Gap |
|-----------------|--------------|----------|---------|-----|
| Mapping table | **Implemented** | `asset_points.source_data_key` → `point_key` | 7/10 | — |
| Mapping admin UI | **Implemented** | `/admin/assets/:assetId/points` + hierarchy drill-down | 7/10 | Bulk mapping tools |
| Onboarding mapping workflow | **Implemented** | Onboarding phases: `point_keys` → `assets` → `mappings` (ADR 0011) | 7/10 | Standalone mapping wizard |
| AI-assisted mapping | **Partial** | Onboarding chat bot (OpenAI or rule fallback) | 5/10 | Suggest mappings from sample payload |
| Catalog validation | **Implemented** | API rejects unregistered `point_key` (ADR 0010) | 8/10 | — |
| Excel-assisted setup | **Partial** | Excel for location/RTU/asset rows; mappings via chat | 5/10 | Excel sheet for mappings |

**As-is score: 72%**  
**Gap effort: 4–6 pw** (bulk tools, payload-based auto-map, Excel mapping sheet)

---

### 7. Calculations

| Sub-requirement | As-Is Status | Evidence | Quality | Gap |
|-----------------|--------------|----------|---------|-----|
| Simple derived (`C = A + B`) | **Missing** | PUE/kWh are hardcoded SQL in `dashboard.service` / `reports.service` | 1/10 | Calc engine + stored definitions |
| User-configurable formulas | **Missing** | No formula DSL or UI | 0/10 | Calc config module |
| Scheduled / KPI calcs | **Missing** | Zoho "scheduled KPI"; not implemented | 0/10 | Cron evaluator |
| ML multivariate time-series | **Missing** | Explicitly deferred (AGENTS.md) | 0/10 | ML pipeline + feature store |
| Vision analytics | **Missing** | No image ingest or CV | 0/10 | Image pipeline + model serving |
| Rule engine as calc substitute | **Partial** | Threshold/time-window rules; evaluate-only, no actuation | 3/10 | Not a calc engine |

**As-is score: 5%**  
**Gap effort: 8–10 pw** (simple derived) · **+20–30 pw** (ML) · **+16–24 pw** (vision)

---

### 8. Configurable Dashboards

| Sub-requirement | As-Is Status | Evidence | Quality | Gap |
|-----------------|--------------|----------|---------|-----|
| Charts | **Implemented** | ECharts on executive, energy, location, load-trend | 7/10 | User-defined chart config |
| Widgets / cards / KPIs | **Implemented** | KPI ribbon, location KPI cards, control-room meters | 7/10 | Drag-drop layout |
| Maps | **Implemented** | Leaflet world map, site health | 7/10 | — |
| Tables | **Implemented** | Alarms, work orders, location asset lists | 7/10 | — |
| User-configurable layouts | **Missing** | Fixed React routes per screen | 0/10 | Dashboard builder |
| Per-asset / per-template dashboards | **Partial** | Location dashboard; control-room per asset-group | 4/10 | Template default dashboards |
| Role-based dashboard sets | **Partial** | Asset-group UI guards | 5/10 | Saved views per role |

**As-is score: 40%** (rich fixed UI; not configurable)  
**Gap effort: 14–18 pw** (widget registry 4–6, builder UI 8–10, persistence 2–3)

---

### 9. Calculation Setup / Configuration

| Sub-requirement | As-Is Status | Evidence | Quality | Gap |
|-----------------|--------------|----------|---------|-----|
| Calc definition UI | **Missing** | — | 0/10 | Admin calc editor |
| Calc execution on ingest | **Missing** | — | 0/10 | Stream processor |
| Calc execution on schedule | **Missing** | — | 0/10 | Job scheduler |
| Link calcs to template tags | **Missing** | Depends on asset templates | 0/10 | Template calc points |
| Audit / versioning of calcs | **Missing** | — | 0/10 | Version table + audit |

**As-is score: 0%**  
**Gap effort: 8–12 pw** (bundled with calc engine in §7)

---

## Consolidated As-Is Matrix

| # | Client Requirement | As-Is % | Status | Quality | Gap Effort (pw) | Priority |
|---|-------------------|---------|--------|---------|-----------------|----------|
| 1 | Data connect SCADA/PLC/DCS/IoT → cloud | 25% | Partial | 4/10 | 40–55 | **P0** |
| 2 | TS + images + relational storage | 55% | Partial | 6/10 | 12–18 | **P0** |
| 3 | Streaming / manual / CSV·Excel TS feed | 25% | Partial | 4/10 | 6–10 | **P0** |
| 4 | Tags on assets | 70% | Mostly done | 7/10 | 3–5 | P1 |
| 5 | Asset templates (I/O/calc tags) | 5% | Missing | 1/10 | 10–14 | **P0** |
| 6 | Tag mapping exercise | 72% | Mostly done | 7/10 | 4–6 | P1 |
| 7 | Calculations (derived + ML + vision) | 5% | Missing | 1/10 | 8–64* | P1–P3 |
| 8 | Configurable dashboards | 40% | Partial | 5/10 | 14–18 | **P0** |
| 9 | Calculation setup / config | 0% | Missing | 0/10 | 8–12 | **P0** |

\*8–10 pw simple derived only; +20–30 ML; +16–24 vision

---

## What Exists Today (Inventory)

### Implemented and client-relevant

| Capability | Location |
|------------|----------|
| Org → Location → RTU → Asset → Point hierarchy | ADR 0008, 0010; `bms-schema.ts` |
| Org-scoped system tag catalog (`point_keys`) | Migration 0018; `/admin/point-keys` |
| Per-asset tag mapping (`asset_points`) | `/admin/assets/:id/points` |
| Master-data admin CRUD | `apps/api/src/admin/*`, web admin pages |
| AI/rule-based onboarding wizard | ADR 0011; `/admin/.../onboarding` |
| Excel template for site setup | ADR 0013; `GET template.xlsx`, upload to session |
| Protocol catalog + RTU connection config | Migration 0020; encrypted credentials ADR 0012 |
| MQTT TLS ingest (pilot) | `apps/ingest` |
| TimescaleDB telemetry | `telemetry.point_values` |
| Live dashboards + control-room schematics | `apps/web` pages |
| WebSocket live tags | `/ws/telemetry` |
| Energy CSV **export** | `/api/v1/reports/energy/export.csv` |

### Partial / not meeting client intent

| Capability | Gap |
|------------|-----|
| Modbus/BACnet/OPC-UA/SNMP | Config stored; adapters not wired |
| Excel/CSV | Master-data only, not time-series history |
| Calculations | Hardcoded PUE in SQL, not user-defined |
| Dashboards | Fixed screens, not operator-configurable |
| Asset creation | Manual/onboarding, not template-driven |

### Missing

| Capability |
|------------|
| DCS protocol adapter |
| Image/binary object storage |
| Manual time-series entry |
| Telemetry bulk import (CSV/Excel) |
| Asset template engine |
| Derived tag calculation engine |
| ML multivariate analytics |
| Vision / image analytics |
| Dashboard builder |
| Calculation configuration UI |

---

## Recommended Delivery Roadmap (Client-Priority)

### Phase A — Data Foundation (Weeks 1–14) · ~42 pw

**Goal:** Client can onboard sites, map tags, and ingest via IoT + manual/CSV paths.

| # | Deliverable | Effort | Req |
|---|-------------|--------|-----|
| A1 | Asset template schema + API (input/output tag defs) | 10–12 | 5 |
| A2 | Instantiate assets from template in onboarding + admin | 4–5 | 5 |
| A3 | Telemetry manual entry API + admin UI | 2–3 | 3 |
| A4 | Telemetry CSV bulk import (tag, timestamp, value) | 3–4 | 3 |
| A5 | Tag mapping bulk editor + Excel mapping sheet | 4–5 | 6 |
| A6 | Timescale retention + 1m/1h continuous aggregates | 4–5 | 2 |
| A7 | Expand MQTT ingest to all enabled RTUs | 3–4 | 1 |
| A8 | Device health / last-seen on assets | 3–4 | 1 |

**Phase A exit:** Templates drive asset+tag creation; streaming + CSV/manual feeds work; mapping is operator-friendly.

---

### Phase B — Industrial Connect (Weeks 15–30) · ~48 pw

**Goal:** PLC/SCADA data flows to cloud.

| # | Deliverable | Effort | Req |
|---|-------------|--------|-----|
| B1 | Ingest adapter framework (`IngestAdapter` interface) | 4–5 | 1 |
| B2 | Modbus TCP adapter (poll → point_values) | 10–12 | 1 |
| B3 | BACnet/IP read adapter (pilot scope) | 10–12 | 1 |
| B4 | OPC-UA subscription adapter | 10–14 | 1 |
| B5 | DCS connector (client-specific protocol) | 8–12 | 1 |
| B6 | Raw message archive + ingest diagnostics | 3–4 | 2 |

**Phase B exit:** At least Modbus + one SCADA protocol live; config from onboarding RTU screen drives ingest.

---

### Phase C — Calculations & Dashboards (Weeks 31–46) · ~38 pw

**Goal:** Operators configure derived tags and dashboards without code changes.

| # | Deliverable | Effort | Req |
|---|-------------|--------|-----|
| C1 | Calculation definition schema (formula DSL: `A + B`, refs) | 4–5 | 7, 9 |
| C2 | Calc execution engine (stream + scheduled) | 4–5 | 7, 9 |
| C3 | Calc configuration UI (admin) | 4–5 | 9 |
| C4 | Template calc tags wired to engine | 3–4 | 5, 9 |
| C5 | Dashboard definition schema (widgets, layout JSON) | 3–4 | 8 |
| C6 | Dashboard builder UI (drag-drop subset) | 8–10 | 8 |
| C7 | Template default dashboard per asset type | 3–4 | 8 |

**Phase C exit:** `Derived_C = A + B` configurable; operators build dashboards from widget palette.

---

### Phase D — Advanced Analytics (Weeks 47–66) · ~44 pw

**Goal:** ML and vision per client requirement.

| # | Deliverable | Effort | Req |
|---|-------------|--------|-----|
| D1 | Object storage (S3/MinIO) + image metadata | 8–10 | 2 |
| D2 | Image upload API + linkage to assets | 3–4 | 2 |
| D3 | ML feature pipeline (multivariate TS export) | 8–10 | 7 |
| D4 | Anomaly detection service (pilot points) | 10–12 | 7 |
| D5 | Vision inference hook (external model API) | 8–10 | 7 |
| D6 | ML/vision results as calc tags | 4–5 | 7, 9 |

**Phase D exit:** Images stored; ML anomalies and vision scores appear as tags on dashboards.

---

## Effort Summary

| Scope | Person-weeks | Calendar (2–3 engineers) |
|-------|--------------|--------------------------|
| **MVP** (Phases A + B1–B2 + C1–C4) | **95–120** | ~8–10 months |
| **Full client vision** (A + B + C + D) | **155–200** | ~14–18 months |
| **Ongoing ops** (HA, monitoring, security hardening) | +15–20 | Parallel |

---

## Mapping to Zoho Gap Matrix Priorities

| Client req | Zoho matrix items leveraged | Notes |
|------------|---------------------------|-------|
| 1 Data connect | Modbus, BACnet, OPC-UA, MQTT, Edge Agent rows | Client DCS may exceed Zoho catalog |
| 2 Storage | TS DB, raw messages; add images (not in Zoho core) | MinIO was deferred in AGENTS.md |
| 3 TS feeds | Data Explorer, aggregation API | CSV TS upload is client-specific |
| 4–6 Tags/templates/mapping | Models, datapoints, mapping | **BMS onboarding now covers much of mapping** |
| 7 Calculations | Computed/KPI datapoints, AI features | ML/vision is client stretch |
| 8 Dashboards | 20+ widgets, dashboard builder | Fixed CR screens are BMS differentiator |
| 9 Calc config | Custom functions, workflows | Simpler formula DSL may suffice |

---

## Risk Assessment (Client Delivery)

| Risk | Impact | Mitigation |
|------|--------|------------|
| DCS protocol unknown | Blocks Phase B5 | Early client workshop; placeholder REST poller |
| Asset templates delayed | Blocks calcs + dashboards | Phase A1 is critical path |
| ML/vision scope creep | +40–54 pw | Phase D optional; agree MVP without D |
| Modbus/BACnet field variance | Adapter overrun | Pilot one site per protocol |
| Dashboard builder scope | 14–18 pw minimum | MVP: 5 widget types, not 20 |

---

## Final Client-Requirement Maturity Score

| Score | Value |
|-------|-------|
| **Overall as-is coverage** | **38 / 100** |
| **MVP-ready after Phase A** | ~55 / 100 |
| **Industrial-ready after Phase B** | ~68 / 100 |
| **Client vision after Phase C+D** | ~88 / 100 |

**Bottom line:** The platform already delivers **relational hierarchy, system tag catalog, tag mapping, and streaming IoT** — roughly **70% of requirements 4 and 6**. Requirements **1 (industrial connect), 5 (templates), 7–9 (calcs + configurable dashboards), and 3 (manual/CSV telemetry)** are the critical path. Prioritize **asset templates → calc engine → protocol adapters → dashboard builder** in that order for highest client value per effort.
