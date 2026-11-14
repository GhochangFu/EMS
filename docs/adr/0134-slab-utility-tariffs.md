# ADR 0134 — Slab utility tariffs and the monthly energy bill

## Status

**Accepted — 2026-11-14** (owner, in chat: "Accepted"; proposed the same
day). Drafted by an agent for backlog row `F4.365` from an owner request on
2026-11-14. The owner ruled eight questions in chat, one at a time; those
rulings are marked *(owner, 2026-11-14)*. Lines marked *(recommended)* were
the agent's calls; the owner accepted the ADR with them as written, so
**every *(recommended)* line is now a ruling**.

Builds on [ADR 0070](./0070-sustainability-metrics-engine.md) (the
effective-dated `bms.calc_parameters` store and `energy_tariff_per_kwh`),
[ADR 0043](./0043-multi-tenant-architecture.md) / [ADR 0045](./0045-non-superuser-table-owner.md)
(tenant tables under RLS) and [ADR 0030](./0030-shared-api-contracts.md)
(response contracts). Adds **two** migrations (`0154`, `0155` — renumbered from `0153`/`0154` after PR #1329 merged, Amendment 2) and **no** dependency.

## Context

The owner supplied `India_Electricity_Tariff_Calculator.xlsx` (prepared
2026-11-14) and asked that a site mapped to a tariff be costed on that tariff
only. The workbook holds:

- **52 tariff areas** (state/UT discoms and private licensees), **316 tariff
  categories**, **461 slab rows**, mostly FY 2026-27.
- Per slab: from/to units (blank "to" = no limit), energy rate (Rs/unit),
  billing unit (`kWh` 377 rows, `kVAh` 84 rows), fixed/demand charge with its
  basis (`Rs/kW/month`, `Rs/kVA/month`, `Rs/HP/month`, `Rs/connection/month`,
  `Rs/connection/bi-month`, or none), wheeling/regulatory surcharge (Rs/unit),
  tariff order, effective date, source URL, and a data status — `Official
  tariff schedule/order` 319, `Secondary source` 101, `Indicative - verify` 41.
- Its calculator: telescopic slabs on the billed units; fixed charge = the
  rate of the highest slab reached × sanctioned load × months (flat for a
  per-connection basis; one bi-monthly charge per bill); wheeling on every unit.
- **Not modelled by the workbook**: ToD, power-factor and load-factor rebates,
  minimum charges, Gujarat's telescopic HT demand (text notes only), and
  electricity duty, FPPAS/FAC and subsidies (typed in per bill). Several areas
  carry no rates ("Rates not captured").

What exists: `bms.calc_parameters` holds **one number** per key and scope
(asset → location → organization, nearest wins, `[effective_from,
effective_to)`). Cost today is `kWh × energy_tariff_per_kwh` per asset
(`apps/api/src/telemetry/energy-cost.ts`, `energy-cost-by-day.ts`). One scalar
cannot carry slabs, a fixed charge or a kVAh rate. Meters already report
`kvah_total` and `pf` (`ELECTRICAL_CLASS_POINT_KEYS`).

## Decision

1. **A global tariff catalog, as data.** Migration `0154` adds two tables
   with no `organization_id` and no RLS — a published discom tariff means the
   same thing for every tenant (the `bms.calc_parameter_keys` reasoning,
   `0074`):
   - `bms.tariff_categories` — `id`, `key` (the workbook's Category Key,
     unique per `effective_from`), `area_id`, `state`, `discoms`, `ownership`,
     `code`, `name`, `segment`, `supply`, `energy_unit` (`kwh|kvah`),
     `fixed_basis` (`per_kw_month|per_kva_month|per_hp_month|per_connection_month|per_connection_bimonth|none`),
     `data_status` (`official|secondary|indicative`), `tariff_order`,
     `effective_from date`, `source_url`, `notes`.
   - `bms.tariff_slabs` — `category_id` (cascade), `slab_no`, `from_units`,
     `to_units` (NULL = no limit), `energy_rate`, `fixed_rate`,
     `wheeling_rate`, `notes`. Unique `(category_id, slab_no)`.
   Rates are numbers in the organization's currency (ADR 0070 `E4.1c`).

2. **Import all rows, flag the weak ones** *(owner, 2026-11-14)*. A one-shot
   importer (`apps/api/src/tariffs/import-xlsx.ts`, run as
   `pnpm --filter api tariffs:import <file>`) reads the **Rate Chart**
   sheet only and upserts by `(key, effective_from)`. It lives in `apps/api`
   because that app already depends on SheetJS `xlsx` — **no new package**. Non-official categories carry a
   **"Verify"** badge wherever they are shown (mapping screen, bill, cost
   tiles). Areas with no rates simply have no categories.

3. **Mapping a site to a tariff.** Migration `0155` adds tenant table
   `bms.location_tariffs` (`organization_id NOT NULL`, ENABLE + FORCE RLS,
   `tenant_isolation` policy checking the location leg, `0074`'s shape):
   `location_id`, `tariff_key` (a tariff **line**, not one version — see
   decision 8), `billing_meter_asset_id` (the site's main
   incomer meter), `sanctioned_load numeric`, `sanctioned_load_unit`
   (`kw|kva|hp`), `effective_from`, `effective_to`. A gist exclusion forbids
   overlapping windows per location. Sanctioned load is **entered with the
   mapping** *(owner, 2026-11-14)*. Mapping is at **location** level only —
   one connection per site *(recommended)*; asset-level mapping is deferred.

4. **Slabs apply to the site main meter's monthly total** *(owner,
   2026-11-14)*. The billed quantity for a calendar month (in the location's
   timezone, ADR 0070 `E4.1b`) is the delta of the billing meter's
   `kwh_total` — or `kvah_total` for a kVAh category. Other assets at the site
   are not summed.

5. **kVAh without a kVAh reading** *(owner, 2026-11-14)*. If the billing
   meter has no `kvah_total` for the month, kVAh = kWh ÷ the month's average
   `pf`, and the bill is marked **estimated**. No `pf` either → no bill, with
   reason `kvah_unavailable`.

6. **The bill** = energy (telescopic slabs) + fixed/demand (highest slab
   reached × sanctioned load × 1 month, flat for per-connection, half for a
   bi-monthly basis per month *(recommended)*) + wheeling (units × rate). A
   pure function in `packages/shared/src/tariffs/compute-bill.ts`, unit-tested
   against the workbook's own calculator on sample categories.
   **Duty, FPPAS/FAC, subsidies, ToD, PF/LF rebates, minimum charges and
   telescopic demand are out of scope** *(owner, 2026-11-14)*; the bill says
   so in a footnote.

7. **Live cost tiles show month-to-date average** *(owner, 2026-11-14)*.
   For a mapped location: rate = bill(month-to-date units) ÷ month-to-date
   units; asset cost = asset kWh × that rate. Past full months use the full
   month's bill. Unmapped locations keep `energy_tariff_per_kwh` unchanged —
   **the mapping wins where it exists**, else the flat parameter.

8. **Editing tariffs from the UI, with effective dates** *(owner,
   2026-11-14: "Yes, admin screen"; "Org admin, own copy")*.
   - The global catalog (decision 1) stays **read-only** in the UI; it
     changes only by re-import.
   - Migration `0155` also adds two tenant tables under RLS, the same columns
     as decision 1 plus `organization_id NOT NULL`, `created_by`, `reason`:
     `bms.org_tariff_categories` and `bms.org_tariff_slabs`. Separate tables,
     not a nullable `organization_id` on the catalog — ADR 0043 Amendment 5
     rejects NULL-means-global.
   - **Revisions are versions of a line.** A tariff line is its `key`. A
     version is one `(key, effective_from)` with its slabs. For a billing
     month the resolver takes, among the catalog's versions and **this
     organization's** versions of the mapped key, the latest `effective_from`
     on or before the month's first day; on the same date the
     organization's version wins. So an org revision applies to every site of
     that org mapped to the line, from its date, and earlier months keep
     their old rates. Another organization never sees it.
   - Versions take effect from the 1st of a month *(recommended)*, so one
     bill never mixes two rate sets.
   - **Screen** — *Admin → Tariffs* (organization `admin`): browse the
     catalog by state/segment; open a line to see every version (catalog and
     own) with its slabs; **New revision** copies the current slabs into an
     editable grid with an effective date and a required reason; **New
     custom tariff** creates an org-only line (key prefixed `custom:`) for a
     private or negotiated tariff. A saved version whose month is already
     billed cannot be edited, only superseded by a newer one
     *(recommended)*; a future-dated one can be edited or deleted.
   - Every write is audit-logged (who, when, reason).

9. **API and screens.**
   - `GET /api/v1/tariffs/categories?state=&segment=` (any authenticated user)
     — catalog lines plus the caller's organization's lines.
   - `GET /api/v1/tariffs/lines/:key/versions`;
     `POST|PATCH|DELETE /api/v1/admin/tariffs/versions` (organization
     `admin`) — org revisions and custom tariffs (decision 8).
   - `GET|POST|PATCH|DELETE /api/v1/admin/locations/:id/tariffs` (location
     `admin`, the `calc-parameters` write rule).
   - `GET /api/v1/locations/:id/energy-bill?month=YYYY-MM` → slab lines,
     fixed, wheeling, total, units, unit type, `estimated`, `dataStatus`.
   - Web: a **Tariff** tab on the location admin page (pick state → category,
     meter, load, dates) and a **Monthly bill** card in the site's Trends &
     Energy section. Zod contracts in `packages/shared/src/contracts/tariffs.ts`.

## Dependencies

None. The importer reuses `xlsx` (SheetJS 0.20.3), already a dependency of
`apps/api`.

## Consequences

- Sites in a state the workbook covers get a bill that matches the discom's
  energy + fixed + wheeling lines; the real bill will be **higher** by duty
  and FPPAS until those are added.
- A tariff change is either a re-import of the catalog (affects every
  organization) or an org revision from the Tariffs screen (affects that
  organization only). Either way old months keep costing on the old rates.
- 142 non-official rows are usable but flagged; they need checking against
  the orders before a customer relies on them.
- Sites with several utility connections need asset-level mapping, deferred.
- Follow-ups filed as backlog rows: duty/FPPAS per site, ToD, PF rebates,
  Gujarat telescopic demand, asset-level mapping.

## Amendment 1 — step-3 plan rulings (2026-11-14)

The owner ruled three plan questions in chat, one at a time:

- **Live rate spreads the fixed charge by days** *(owner)*. For the
  month-to-date rate of decision 7 only, the fixed/demand charge counts
  `elapsed days ÷ days in month` of its monthly amount. The monthly bill
  (decision 6) still shows the full fixed charge.
- **Units above a closed last slab are billed at the last slab's rate**
  *(owner)*, and the bill carries a warning that the category does not
  officially cover them (`overflowUnits`). This departs from the workbook,
  which leaves them unbilled.
- **Revisions may be backdated** *(owner)*: any first-of-month date, past or
  future. Months from that date re-price on the next read; the audit row
  records the reason. A version already in force cannot be edited or deleted,
  only superseded.

Agent calls accepted with the plan: the versions route takes the key as a
query parameter (`GET /api/v1/tariffs/lines/versions?key=`), because 104 of
316 keys contain `/`; for kVAh categories the live rate divides by the billing
meter's **kWh**; the derived `energy_cost_*` calc points keep the flat
parameter (follow-up row).

## Amendment 2 — build and review rulings (2026-11-14)

The owner ruled three review questions in chat, one at a time:

- **A read spanning several months prices each local month at its own rate**
  *(owner)*. A mapped asset's kWh is split by local month in the location's
  zone; a complete month uses that month's full bill rate, the running month
  its month-to-date rate (Amendment 1). A report ending on a month's last
  local day is priced at that month, never the next (code review finding 1).
- **The month-to-date rate stays visible to anyone who can read the site's
  assets** *(owner)*. Trade-off recorded: a user who can read some assets of a
  mapped site but not its billing meter can see the per-kWh rate, and since a
  slab bill ÷ units moves with units, could over time estimate the site-wide
  main-meter consumption by fitting the (public) catalog lines. Accepted as a
  slow, indirect inference; the bill itself (`/locations/:id/energy-bill`)
  still answers 404 to a caller who cannot read the billing meter.
- **Migration order** *(owner)*: PR #1329 (F4.364, also numbered `0153`)
  merges first; this row then renumbers to `0154_tariff_catalog` /
  `0155_location_tariffs`, appended after it, and updates every reference.

Recorded build facts that differ from the decision text:

- Decision 9's "Tariff tab on the location admin page" is built as a
  **Tariff row action** on the Locations screen opening
  `/admin/locations/:locationId/tariff` (plan Q10; that page has no tabs).
- Decision 3's policy names the location leg; `location_tariffs`'
  `tenant_isolation` **also checks the billing-meter asset's organization**,
  because referential-integrity checks run with row security off and the
  location leg alone would let a tenant name another organization's meter.
- **The catalog import is deliberately unaudited.** `tariffs:import --apply`
  and `db:seed` write the global catalog with no actor; the record is the
  reviewed git diff of `packages/db/src/tariff-catalog.json` and its recorded
  workbook sha256. A re-import never deletes a category version (a mapping may
  still read it), so a version dropped from a later workbook stays on existing
  databases until removed by hand.
- The importer refuses a Rate Chart over 5,000 data rows rather than cutting
  it, and reads only the sheet's 22 columns (security review L1, L2).
