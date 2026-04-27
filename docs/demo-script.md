# Prototype demo script (~15 minutes)

Audience: mixed (internal, Eskom stakeholder, investor). Goal: show a
coherent **telemetry → API → React** story across seven screens without
reloads, simulator restarts, or visible errors.

**Prerequisites:** `pnpm db:migrate && pnpm db:seed`; copy `.env` files
per [`local-setup.md`](./local-setup.md). Three terminals: `api` (:4000),
`web` (:5173), `sim` (live inserts + NOTIFY). Browser: logged in as
`admin@bms.local` / `admin123`.

---

## 0–2 min — Login & Executive Dashboard

1. Open `http://localhost:5173`, sign in.
2. Stay on **Overview** (Executive Dashboard). Call out: live KPIs,
   load trend, PUE band — all from the same `kw` aggregates the Energy
   Centre will reuse.
3. Mention **green top bar**: Overview, Sites, Energy are real routes;
   Settings is placeholder.

## 2–4 min — Alarm Centre

1. Sidebar → **Alarms**. Show list + severity; note Socket.IO can
   invalidate when sim trips points (if an alarm is visible, point at it).

## 4–6 min — World Map

1. Top nav **Sites** or sidebar **Map**.
2. Pan/zoom; click a marker → popover with KPIs and link to dashboard.
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

## Close

- Offer Q&A; if asked “is this production?”: prototype scope per
  [`AGENTS.md`](../AGENTS.md) — no multi-tenant RLS, no real BACnet, etc.
- If something errors: check sim is running and DB has recent
  `telemetry.point_values` for `kw`.
