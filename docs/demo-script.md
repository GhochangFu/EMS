# Prototype demo script (~15 minutes)

Audience: mixed (internal, Eskom stakeholder, investor). Goal: show a
coherent **telemetry → API → React** story across seven screens without
reloads, simulator restarts, or visible errors.

**Prerequisites:** `pnpm db:migrate && pnpm db:seed`; copy `.env` files
per [`local-setup.md`](./local-setup.md). Three terminals: `api` (:4000),
`web` (:5173), `sim` (live inserts + NOTIFY). Browser: logged in as
`admin@bms.local` / `admin123`. Scoped access demo users are
`wc-admin@bms.local` / `admin123` (Western Cape location admin),
`phe-admin@bms.local` / `admin123` (PHEWB organization admin), and
`wc-hvac-admin@bms.local` / `admin123` (Western Cape HVAC asset group).

---

## 0–2 min — Login & Executive Dashboard

1. Open `http://localhost:5173`, sign in.
2. Stay on **Overview** (Executive Dashboard). Call out: live KPIs,
   load trend, PUE band — all from the same `kw` aggregates the Energy
   Centre will reuse.
3. In **Location performance**, use the organization filter (**All**,
   **ESKOM**, **PHEWB** — only orgs visible in your scope appear). With
   **All** selected, locations group in accordion sections per org
   (default expanded) with section totals; pick a single org for a flat
   grid of that org's cards only.
4. Click a location KPI card to open `/locations/:locationId/dashboard`;
   scoped users land directly on their assigned location when they have
   only one location.
5. PHEWB stations appear as location cards with org badge `PHEWB` and RTU
   counts; open **Bhutnirghat** (`phe-bhutnirghat`) to see two RTUs (I and II)
   with live MQTT on RTU I only when ingest is running.
6. Sign in as `wc-admin@bms.local` or `phe-admin@bms.local` to show scoped
   org filters (ESKOM-only or PHEWB-only) without empty tabs for other orgs.
7. Mention the aligned shell: dark top bar, green route nav, grouped module
   sidebar, KPI ribbon, and dark status bar.

## Optional — Master Data Administration

1. Top nav **Settings** or sidebar **Administration** (master-data roles:
   global admin, organization admin, location admin).
2. As **admin**: open **Organizations** → click **ESKOM** or **PHEWB** to drill
   into locations, then location → RTU → asset → point mappings.
3. Use horizontal tabs or sidebar shortcuts; hierarchy dropdowns on each level
   jump to the matching nested URL.
4. Open **Point Keys** → manage org-scoped catalog entries (admin: any org;
   organization admin: assigned org only).
5. Open **Asset Points** → map `sourceDataKey` to catalog `pointKey` via
   dropdown (API rejects unknown keys).
6. Sign in as **phe-admin@bms.local** / `admin123`: confirm PHEWB org,
   locations, RTUs, assets, point keys, and mappings are editable; ESKOM rows
   are out of scope.
7. Sign in as **wc-admin@bms.local**: confirm scoped org(s) and Western Cape
   locations only; **Point Keys** tab hidden; mappings use read-only catalog.

## 2–4 min — Alarm Centre

1. Sidebar → **Alarms**. Show list + severity; note Socket.IO can
   invalidate when sim trips points (if an alarm is visible, point at it).

## 4–6 min — World Map

1. Top nav **Sites** or sidebar **Map**.
2. Pan/zoom; click a marker → popover with KPIs and link to its location
   dashboard where a canonical `locationId` exists.
3. Note live colour from alarms / freshness (sim keeps data warm).

## 6–9 min — Electrical SLD

1. Sidebar → **Electrical** (`/sld`).
2. Watch power-flow animation scaling with kW; click a feeder → drawer.
3. One sentence: same telemetry pattern as CRAC, different SVG.

## 9–12 min — CRAC / Cooling

1. Sidebar → **Cooling** (`/crac`).
2. Point at supply/return temps, fan, compressor health, CHW loop.
3. Tie back: HVAC domain in sim, same hypertable as electrical.

## 12–15 min — Energy Centre

1. Top nav **Energy** or sidebar **Energy** (`/energy`).
2. Window selector: **24h** → **7d** → **30d** (charts refetch).
3. KPI row: total kWh, peak kW, PUE (same estimator as executive),
   indicative ZAR cost (tariff from `ENERGY_TARIFF_ZAR_PER_KWH`).
4. Stacked **source mix**: solar from assets `PV*`, nominal DG slice,
   remainder grid — **narrative**, not meter-grade split.
5. **Top consumers**: horizontal bars = rough kWh from avg kW × window
   length.
6. Footer: clock + “Prototype · telemetry-driven”.

## Optional extension — Operations & Control Room

1. **Maintenance**: show the Kanban, status counts, filters, and create
   action. Note that schedule-generated work orders land here.
2. **Schedule Centre**: show due/overdue rows and the conversion action.
3. **Rule Engine**: open a rule, show the guided IF/THEN builder and
   execution trace without changing thresholds during the demo.
4. **Reports**: preview Energy Consumption and point out that CSV is the
   active Sprint E export; PDF/XLSX and persisted storage remain deferred.
5. **CR · Main Dashboard**: show drilldowns into Electrical SLD, IT/Racks,
   UPS, Battery, HVAC, and Environment. Each promoted CR page uses the same
   shell/header pattern, rule-driven status colours, and disabled command
   buttons for controls that are intentionally out of scope.

## Optional extension — Scoped Access

1. Sign out and log in as `wc-admin@bms.local` / `admin123`. Confirm the
   shell shows location access, the landing page is the Western Cape
   dashboard, and lists/maps/charts are scoped to assigned assets.
2. Sign out and log in as `wc-hvac-admin@bms.local` / `admin123`. Confirm
   the limited-scope banner appears, HVAC-backed pages remain available,
   and non-HVAC Control Room links are hidden or return scoped empty states.

## Close

- Offer Q&A; if asked “is this production?”: prototype scope per
  [`AGENTS.md`](../AGENTS.md) — no multi-tenant RLS, no real BACnet, etc.
- If something errors: check sim is running and DB has recent
  `telemetry.point_values` for `kw`.
