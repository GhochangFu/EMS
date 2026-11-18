# ADR 0138 — Degradation trends and time-to-limit estimates (`E1.5`)

## Status

**Proposed — 2026-11-18.** Drafted by an agent for backlog row `E1.5` at the
step 2 gate (AGENTS.md §10, `docs/build-operating-model.md`). Nothing is built
until the owner rules on the questions in §Open questions. Lines marked
*(recommended)* are the drafter's calls; each one is also an owner question,
and "accept as recommended" accepts all of them.

Builds on [ADR 0050](./0050-asset-health-score.md) (the health score, its
per-tag in-range counters `telemetry.point_in_range_*` and its bands; its
Amendment 5 five-input read), [ADR 0135](./0135-ml-serving-foundation.md)
(the ML posture: real assets only, advisory only, no accuracy figure;
Amendment 5 ruling 4), [ADR 0137](./0137-optimisation-advisories.md) (the
read-time advisory pattern: *Estimated* label, *Advisory* pill, disclaimer,
assumptions, decision 8's "reaches nothing"), [ADR 0122](./0122-work-order-depth.md)
(work orders with cause codes and closure) and [ADR 0030](./0030-shared-api-contracts.md)
(contracts).

**Why a new ADR and not an ADR 0135 amendment** *(recommended, **Q1**)*.
ADR 0135 decides how `apps/ml` scores telemetry. This ADR adds no `apps/ml`
job: it is a read-time trend over counters the API already owns (ADR 0050).
ADR 0135 line 103 already says RUL is "decided in its own ADR".

## Context

`E1.5` is *"Asset degradation + Remaining Useful Life + maintenance-schedule
forecasts"* (P2, 8–10 days, wave 5). Its dependencies are done: `E1.3` ✅
(health score) and `E3.1` ✅ (work-order depth). The SOW (§4.4 *Predictive
Forecasting*) lists "Asset degradation", "Remaining Useful Life (RUL)" and
"Maintenance schedules", and ends: "Forecasts shall support both short-term
operational planning and long-term asset management."

**What exists today, checked on `main` (`7d89ec4a`) and on the demo host
(2026-11-18, read-only):**

- **No failure history.** A model that learns RUL needs failures to learn
  from. The demo host has **0** closed work orders with a cause code; the only
  work orders and schedules are seed rows. The readiness CLI
  (`packages/db/src/ml-data-readiness.ts`) sets a floor of 10 closed work
  orders (its "first look" floor, not a READY verdict) and reports "NOT READY
  rul" (2026-11-15 run). ADR 0135 records the same: "RUL is **NOT READY**
  everywhere: no real asset has a closed work order."
- **No lifecycle data.** No asset or template field holds an install date, a
  commissioning date, a rated life, an MTBF or a warranty. `bms.assets` has
  only `rating varchar(32)`, `trip_cause` and `meta`; no `meta` key on the
  host looks like a lifecycle field.
- **No usage counters on real assets.** The catalogs define `run_hours_h` and
  `start_count` (pumps, compressors, DG sets), but no real asset on the host
  reports them. The only counters with data are `kwh_total` and
  `outlet_flow_totalizer_kl`.
- **Maintenance schedules are calendar only.** `bms.maintenance_schedules`
  holds `interval_days`, `next_due_at` and `last_completed_at`.
  `last_completed_at` is written nowhere outside the demo seed: closing a work
  order does not record the service (conversion to a work order already moves
  `next_due_at`). The `runtime`, `condition` and
  `predictive` generation modes are labels with no logic.
- **The health score has a history, unread.** The score is computed at read
  time, but its inputs are kept: `telemetry.point_in_range_1h` and `_1d` hold,
  per asset, point and bucket, `in_range_count`, `sample_count` and
  `rule_count`. "Nothing deletes a counter row" (ADR 0050). So a daily health
  score can be derived for every past day the counters cover. The `_1d`
  buckets (counters and `telemetry.point_values_1d`) are **UTC** days, so
  local days are built from the `_1h` buckets.
- **Data length on the host.** Real assets have about 42 days of hourly data;
  the WBLDC cold rooms have about 132 days (the imported history). Enough for
  a 28-day trend now.

So a true RUL (a learned time to failure) cannot be built honestly today.
What can be built is a **trend estimate**: is the asset's condition getting
worse, and if the trend holds, when does it reach a limit that already exists
(a health band or a threshold rule)?

## Decision

### 1. What `E1.5` delivers now: a time-to-limit trend, not a learned RUL *(recommended, **Q2**)*

For each real asset, two **condition indicators** are read as daily values,
and each is checked for a worsening trend:

Both indicators use **local days** in the asset's zone, built from the `_1h`
buckets (the `_1d` buckets are UTC days):

- **(a) Health trend.** The asset's daily health score, from
  `telemetry.point_in_range_1h` summed per local day, with the asset's
  current tag weights (ADR 0050 §method). The limit is the `minScore` of the
  template's band named `fair`, so the estimate reads "reaches *Poor*". A
  template with no `fair` band has no health trend.
- **(b) Point drift.** For each **ruled** point that is also an ML target
  (`DEFAULT_ANOMALY_TARGETS` / `DEFAULT_TARGETS` classes; for example
  `cold_room_temp_c`), the daily mean from `telemetry.point_values_1h`
  (Σ`sum_value` ÷ Σ`sample_count` per local day). The limit is the nearest
  enabled, published threshold rule on that point in the direction of the
  drift (warning first, then critical).

A trend is **reported only when all of these hold** (the numbers are the
drafter's; Q3):

| Rule | Value |
|---|---|
| Window | the last 28 local days, today excluded |
| Coverage | ≥ 21 of the 28 days have a value (75 %) |
| Slope | Theil–Sen median slope, robust to single bad days |
| Significance | Mann–Kendall test, two-sided p < 0.05, **and** the slope's 90 % interval does not include 0 |
| Direction | toward the limit (a falling health score; a point mean moving toward its rule) |
| Horizon | the projected crossing is between 1 and 90 days away; beyond 90 days it reads "No limit within 90 days" |
| Already past | if the latest 3-day mean is already beyond the limit, no projection; the existing alarm or band shows it |

**Output per indicator:** the current value, the limit and its source (band
or rule name), the slope per week, and the **estimated days to the limit as a
range** (from the slope's 90 % interval), never a single date. Example: *"At
the trend of the last 28 days, the health score reaches Poor in about 18–40
days."*

**Name on screen** *(recommended, **Q4**)*: **"Time to limit (trend)"**, not
"Remaining useful life". The SOW item is met by this estimate; the screen does
not claim a failure prediction it cannot make. The ADR and the backlog map it
to the SOW's RUL line.

### 2. Read time in the API; no table, no migration, no `apps/ml` change *(recommended, **Q5**)*

The trend is computed in a new `apps/api/src/degradation/` module at read
time, as `E1.6` advisories and the `E1.8` health inputs are:

- **Reads:** the candidate read through `withReadScope` (tenant isolation by
  RLS), narrowed by the caller's `readableAssetIds` on both branches, so a
  location- or asset-group-scoped user sees only their assets (ADR 0137
  decision 6); the counters and hourly aggregates on the fleet pool with the
  candidate ids only, every value bound (ADR 0137 Q3 pattern).
- **Cost:** one asset is at most 28 × 24 hours × its tags rows of
  `point_in_range_1h` plus the same for each drift point. The fleet list is
  capped at 200 assets: the 200 with the lowest current health score, with a
  "showing 200 of N" line (the shape of ADR 0137's cap).
- **Math:** Theil–Sen and Mann–Kendall in a pure TypeScript file with unit
  tests (no new package; n ≤ 28 makes both O(n²) trivial).
- **Real assets only:** the same predicate as `apps/ml` and `E1.6`
  (`meta.telemetrySource = 'mqtt'` or a measured point on an `ingest_enabled`
  RTU). Simulated assets get no trend *(recommended, **Q6**)*.

Consequence: like `E1.6`, there is no history of past estimates.

### 3. The advisory posture *(recommended, **Q7**)*

The same posture as ADR 0137 decision 3 and decision 8:

- Label *Estimated*, the *Advisory* pill (`StatusPill tone="info"`), never a
  severity colour.
- A fixed disclaimer: *"A trend from the last 28 days, not a failure
  prediction."*
- An *Assumptions* list: the window, the coverage, the limit and its source,
  and "the tag weights and rules in force today are applied to past days".
- No percentage confidence, no accuracy figure.
- **It reaches nothing:** no alarm, notification, work order, report,
  export, copilot answer or copilot tool, and it changes no schedule. No
  dismiss state. No LLM wording.
- **The one stated exception** to ADR 0137 decision 8 is decision 5: a
  display-only note shown *beside* a maintenance schedule (ruled by **Q9**).
  The note states two dates and never recommends an action.

### 4. Where it shows *(recommended, **Q8**)*

- **Asset history page** (`/asset-history/:assetId`): a *Degradation —
  advisory* section with one line per indicator that has a reported trend,
  and nothing when none does (the `E1.6b` rule: no empty section).
- **Asset health card:** one line under the five inputs when the health trend
  is reported ("Trending down: reaches Poor in about 18–40 days").
- **Control room, organization and site pages:** a *Trending toward a limit —
  advisory* card listing the up to 10 assets with the nearest estimated
  crossing, after *Bad actors — advisory*, not on the wall (the `E1.9e` /
  `E1.8c` rule).
- No new navigation item and no new page.

### 5. Maintenance-schedule forecast: a note beside the schedule, display only *(recommended, **Q9**)*

On the *Maintenance schedules* panel and on the asset history section, when a
reported trend's earliest crossing comes **before** the asset's next due
date, show one line that states the two dates and nothing more: *"Trend
reaches its limit in about 18–40 days; next service due in 52 days."* It does
not say "service early". The schedule is not changed, no work order is opened
or proposed, and nothing is written.

The two gaps that block a real usage-based or condition-based schedule are
**not** in `E1.5` and get their own rows (decision 7): a closed work order
does not update `last_completed_at`, and real assets have no run-hours.

### 6. Learned RUL waits for its data *(recommended, **Q10**)*

A learned RUL (from failures) is a later row, `E1.5d`, parked with a start
condition: **≥ 10 closed work orders with cause code `equipment_failure` or
`wear_and_tear` in one asset class** (the CLI's "first look" floor, read with
a query; the readiness CLI counts all closed work orders today, so `E1.5d`
adds the cause-code filter to it), plus an amendment to this ADR. Until then the screen never says "remaining useful
life".

### 7. Rows this ADR creates *(recommended, **Q11**)*

| Row | What | State |
|---|---|---|
| `E1.5a` | API: contract `degradation.ts`, the trend math, reads, `GET /degradation` (fleet, capped) and `GET /assets/:assetId/degradation`, the schedule note | build |
| `E1.5b` | Web: the asset history section, the health-card line, the control-room card, the schedule-panel note | build |
| `E1.5d` | Learned RUL from failure history | parked (decision 6) |
| `F4.385` | A closed work order linked to a schedule sets `last_completed_at` (`next_due_at` already moves at conversion, so it is not moved again; ADR 0122 follow-up; it also starts the service history `E1.5d` needs) | ⬜, its own ruling |
| `F4.386` | Lifecycle fields on assets (install date, rated life) | ⬜, needs its own ADR (migration) |

`E1.5c` is not used (kept free so the letters match the decisions). `F4.385`
and `F4.386` take the next free numbers at merge.

## Dependencies

None. No npm or Python package; no migration; no change to `apps/ml`.

## Consequences

- The demo shows a degradation estimate now, on the 42–132 days of data the
  host has, without claiming a failure prediction.
- The estimate depends on the threshold rules and health bands being right.
  An asset with no rules has no health trend and no drift limit, so it shows
  nothing (as the health score does today).
- Rules and weights in force today are applied to past days. A rule added last
  week makes the earlier days look different; the *Assumptions* list says so.
- Read-time compute means no history of past estimates, and the same
  CPU-bound route cost as `E1.6` on the shared 2 vCPU host. The stop rule is
  set in the plan.
- The SOW's "Remaining Useful Life" is met as a trend estimate; a learned RUL
  waits for `E1.5d`. This must be said to the client in those words.
- No §6 promotion: no AGENTS.md §6 line names RUL or degradation. The
  `chore(agents):` catch-up after closure adds the module to §2/§3.

## Open questions for the owner

Each has a recommended answer. "Accept as recommended" accepts all of them.

1. **Q1 — New ADR or an ADR 0135 amendment.** *Recommended: a new ADR (this
   one).* (Alternative: Amendment 11 to ADR 0135.)
2. **Q2 — What `E1.5` delivers now.** *Recommended: the time-to-limit trend
   on two indicators (health trend, point drift).* (Alternatives: (b) wait
   until failure history exists and build nothing now; (c) the health trend
   only.)
3. **Q3 — The trend rules.** *Recommended: as in the table of decision 1
   (28 days, 75 % coverage, Theil–Sen, Mann–Kendall p < 0.05 and the 90 %
   interval excluding 0, 1–90 days horizon).* The plan measures them on the
   host's data before the build and reports how many assets would show a
   trend.
4. **Q4 — The name on screen.** *Recommended: "Time to limit (trend)".*
   (Alternative: "Remaining useful life (estimate)", closer to the SOW words
   but a stronger claim.)
5. **Q5 — Where it is computed.** *Recommended: read time in the API, no
   table.* (Alternative: an `apps/ml` daily job writing `ml.degradation_*`;
   a migration, history of estimates, and the ruling-5 budget.)
6. **Q6 — Which assets.** *Recommended: real assets only.* (Alternative: also
   simulated assets, for the ESKOM demo.)
7. **Q7 — The posture.** *Recommended: ADR 0137's posture (decision 3), with
   the one stated exception of decision 5 (Q9).*
8. **Q8 — The surfaces.** *Recommended: the asset history section, the health
   card line and the control-room card; no new page.* (Alternative: also a
   tab on `/advisories`.)
9. **Q9 — The schedule forecast.** *Recommended: a display-only note when the
   trend crosses before the next due date.* (Alternative: no schedule note in
   `E1.5`.)
10. **Q10 — Learned RUL.** *Recommended: parked as `E1.5d` with the start
    condition of decision 6.*
11. **Q11 — The rows and the PR split.** *Recommended: as in decision 7 —*

    | Child | What | Size |
    |---|---|---|
    | PR 0 | the step-3 plan | docs |
    | `E1.5a` | API, contract, math, routes, schedule note data | 3–4 days |
    | `E1.5b` | web surfaces | 3–4 days |
    | closure | backlog, ADR build record, then the `chore(agents):` catch-up | docs |

    *and `F4.385` / `F4.386` filed as their own rows.*
