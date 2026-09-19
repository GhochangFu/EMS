# ADR 0070 — Sustainability metrics engine: a parameter store and `bms-calc-v3` with parameter references and time windows (`E4.1`)

## Status

Accepted — drafted and ruled 2026-09-18 under `E4.1`. Six gate questions
(§"Gate questions") were put to the owner one at a time, in order, before any
implementation code (AGENTS.md §10, `backlog-cycle` step 2). **Two were ruled
against the recommendation** — Q1 (the mechanism) and Q2 (the window kinds) —
and both recommendations are kept below with their cost, so a reader who later
meets the window engine or the timezone column can see that the cheaper shape
was declined deliberately. Q3, Q4 and Q5 were ruled as recommended. Q6 was
found by review of the drafted text — the cagg's sum is a sample sum, not a
quantity — and ruled as recommended the same day. Ten further
rulings were taken by the drafting agent as routine calls and are listed in
§"Ruled here without a question" so the owner can overturn any of them at the
plan gate.

**Accepted is not implemented.** Every guard this ADR reopens is still in the
code; `E4.1a` is what changes the grammar, and `E4.1b`/`E4.1c` follow it.

| Gate question | Ruling | Decision |
| --- | --- | --- |
| Q1 — mechanism | Full grammar extension: `bms-calc-v3` with parameter references **and** time windows (against the recommendation) | 3, 4, 5 |
| Q2 — window kinds | Rolling **and** calendar windows (against the recommendation) | 5, 6 |
| Q3 — where factors live | One table, nearest scope wins, effective-dated | 2 |
| Q4 — the Rand tariff | Both call sites absorbed; DTO fields renamed | 7 |
| Q5 — the row's shape | Split into `E4.1a` ⭐ / `E4.1b` / `E4.1c` under an umbrella | 1 |
| Q6 — what `sum` over a window means | The time integral (`avg × hours`); no `count` | 5 |

## Context

`E4.1` (Track C, Wave 3, P1, *"Sustainability metrics engine: savings
baselines (energy/water/chemical), carbon factors, downtime/efficiency deltas
as derived tags"*, `Depends: F2.4`) is the first row of the SOW §7 ESG module.
Its one dependency closed on 2026-08-21 (ADR 0037, PR #116). The row was
written on 2026-08-17 from the SOW mapping (`docs/archive/sow-ems-pending-features.md`
row `E4.1`: *"built as derived tags on the calc engine"*), before the calc
grammar existed. Nine things are true of the repository today, each read from
source on 2026-09-18.

**1. The grammar cannot express any of the row's four deliverables.** The AST
(`packages/shared/src/calc-dsl/ast.ts`) has seven node kinds — `number`, `ref`,
`unary`, `binary`, `call`, `qref`, `aggregate` — and no node reads a stored
scalar or bounds a time window. ADR 0037 decision 3 is explicit: *"the current
value of `{X}` is the latest stored sample, not a window … Rolling aggregates
would need grammar support that does not exist."* ADR 0055's `sum`/`avg`
range over **assets** (`@site`, `@domain`, `@group`), never over time. A
savings baseline is a stored reference compared against a period total; a
carbon figure is a rate multiplied by a stored factor. Neither side of either
expression exists.

**2. The stock catalog already parks about twenty derived codes on exactly
these two gaps.** `apps/api/src/admin/asset-templates/stock-catalog/electrical.ts:31-52`
is a deferral ledger: `load_pct`, `demand_vs_contract_pct`, `pf_penalty_flag`,
`performance_ratio_pct`, `specific_yield_kwh_kwp_day`, `fuel_hours_remaining_h`,
`co2_avoided_kg`, `specific_energy_kwh_kl` each *"need an asset or site
attribute `bms-calc-v1` has no way to read"*; `tap_changes_per_day`,
`starts_per_day`, `availability_pct`, `underload_hours`, `battery_events_per_month`
each *"need a time window the grammar has no state for"*. A tariff, a carbon
factor, a baseline and an installed kWp are all the first class. Downtime and
a daily total are the second. `E4.1` is therefore not a new engine beside the
calc engine; it is the two extensions the ledger has been waiting for.

**3. B14 is unanswered, and the position on record is ours.**
`docs/ion-exchange-response-form-2026-08-17.md:51,98` is the blank form;
`docs/BACKLOG.md` §8.1 lists the answers that moved (A2, A5, B15, C22a, C20)
and B14 is not among them; the 2026-08-22 reply names only *"sustainability/ESG
module with your tariffs, factors and baselines"* in its later-phase block.
The handover (`docs/ion-exchange-client-handover-2026-08-17.md:76`) states
**our proposal**: tariffs, carbon factors and baselines are *"configuration
supplied by Ion Exchange, not values we derive"*, and *"savings are measured
against a commissioning benchmark"*. The clarification document records a
deliberate refusal on the two executive KPIs: *"We will not guess a formula
that appears on an executive screen"* (Water Recycle %, Operational
Efficiency %), and ADR 0050 §"Not in this ADR" already declined Operational
Efficiency on the same ground. This ADR ships the mechanism and the
configuration surface **with no factor values and no KPI definitions**.

**4. A Rand tariff is duplicated on a rupee product.** `energyTariffZar()`
exists twice — `apps/api/src/dashboard/dashboard.service.ts:658` and
`apps/api/src/reports/reports.service.ts:336` — each reading
`ENERGY_TARIFF_ZAR_PER_KWH` with a hardcoded `2.15` default, and the DTOs carry
`indicativeCostZar` / `tariffZarPerKwh`. This is `estimatePue()`'s shape
exactly — a constant fitted into two services with no covering test — and
`F2.8` (ADR 0055) is the precedent for removing it. ADR 0013 made this
repository the Ion Exchange line; the SOW asks ₹/kWh and ₹/kL.

**5. The continuous aggregates carry sums and counts, in UTC, with a
real-time tail.** `packages/db/drizzle/0027_continuous_aggregates.sql`
materialises `point_values_1m/5m/1h/1d` with `sum_value`, `sample_count`,
`min_value`, `max_value` per `(bucket, asset_id, point_key)`, `time_bucket`
without a timezone argument, and `materialized_only = false` — so a query
over a view unions the un-materialised raw tail automatically. No view carries
a first or last sample, so a delta over a cumulative counter (`kwh`, `kl`) must
read `point_values` itself.

**6. No location has a timezone, and India's offset is a half hour.**
`bms.locations` (`packages/db/src/schema/bms-schema.ts:63`) has no timezone
column. IST is UTC+05:30, so a calendar day at an Indian site starts at 18:30
UTC: the `1h` and `1d` buckets never align with it, the `5m` buckets do.

**7. Two vocabulary and tenancy precedents bind the new tables.** ADR 0031/0032
rule that a vocabulary whose behaviour is carried as data is a lookup table,
never a hardcoded enum plus `CHECK`; ADR 0049 decision 5 rules that a *code*
must mean the same thing in every organization for a stock template to be
portable. ADR 0043 and ADR 0045 mandate `organization_id NOT NULL` and forced
row-level security in the creating migration of every tenant table.

**8. A read-time metric surface exists and was considered.** ADR 0048's
`METRIC_CATALOG` (`packages/shared/src/contracts/dashboard-builder.ts:556`) is
the read-time path for non-point data, and its `params` column is stored but
unread. It was the recommended home for period totals (Q1) and was declined.

**9. The grammar's own extension precedent is one ADR old.** ADR 0055 shipped
cross-asset references as a **new dialect string** with the previous dialect
frozen at its exact meaning (decisions 2–4), a strict-superset property test,
`scheduled`-only evaluation (decision 10), fail-closed partial input
(decision 11) and location containment (decision 12). Every one of those
rules applies here unchanged, and this ADR cites them rather than restating
them.

## Gate questions

Put to the owner one at a time, 2026-09-18, each with the recommendation
first.

**Q1 — Mechanism: which shape does the engine take?** Four were offered.
*(a)* **Hybrid, recommended**: a parameter store plus a `$key` reference in a
new `bms-calc-v3` for rate tags (kgCO₂/h, ₹/h, delta versus baseline), with
period totals and savings read at request time from `point_values_1d` ×
parameters as `sustainability.*` catalog entries (ADR 0048's shape) — no
window functions, no timezone column, one rule ("a rate is a tag, a period
total is a metric"). *(b)* **Full grammar extension**: `$key` **and**
time-window functions, so every sustainability figure is a stored derived tag.
*(c)* A service-side engine writing daily rows from a worker job (ADR 0050's
shape). *(d)* Read-time only.

**Ruled (b), against the recommendation.** The row's wording stands: every
sustainability figure is a stored tag that alarm rules, reports, templates and
dashboards read the same way they read any other point, and the deferral
ledger's window class (Context 2) is unblocked in the same stroke. The cost the
recommendation named is accepted and recorded: window semantics, a calendar
and timezone rule, cagg reads inside the evaluation host, and a third dialect
with its own superset property test. `E4.1b` carries it (decision 1).

**Q2 — Window kinds: rolling, calendar, or both?** *(a)* **Rolling only,
recommended**: `sum({kw}, 24h)` and friends over a duration ending at the
tick, no timezone needed; calendar periods stay read-time. *(b)* **Rolling and
calendar**: adds `today`, `this_week`, `this_month`, `this_year` in the site's
zone, which needs a `timezone` column on `bms.locations`, a migration, an admin
field, half-hour-aligned bucket arithmetic, and a tag whose value resets at
midnight. *(c)* Calendar only.

**Ruled (b), against the recommendation.** The reference dashboard's KPI row
reads *"Energy Today"* and *"Water Today"* (`docs/ux/ion-exchange-reference-alignment.md:97`),
and a stored tag that means *today* is what `E4.2` binds a tile to. The
timezone column and the midnight reset are accepted costs; decision 6 bounds
them.

**Q3 — Where tariffs, carbon factors, baselines and ratings live.** *(a)*
**One table, nearest scope wins, effective-dated, recommended.** *(b)* Three
purpose tables (`energy_tariffs`, `emission_factors`, `savings_baselines`),
each with its own form — and a fourth for nameplate values, and a namespace
per table in the grammar. *(c)* Per-asset values as template content,
instantiated onto every asset — no effective dates, and a site tariff copied
onto every asset and re-edited on every change. **Ruled (a)**; decision 2.

**Q4 — The Rand tariff.** *(a)* **Absorb both call sites in `E4.1`,
recommended**, rename the DTO fields currency-neutral, add `currency` to the
organization. *(b)* Leave them and file a row — two tariff sources in the
meantime, and the Rand default stays. *(c)* Absorb but keep the field names —
the name then lies about the unit. **Ruled (a)**; decision 7.

**Q5 — Split the row?** *(a)* **`E4.1a` ⭐ / `E4.1b` / `E4.1c` under an
umbrella, recommended** (the `F3.1` shape, ADR 0047 decision 1). *(b)* One
row, one staged plan — one eight-plus-week row with a single §4.6 pass and one
review sweep at the end. *(c)* Two children, engine and content. **Ruled
(a)**; decision 1.

**Q6 — What does `sum` over a window mean?** Raised by review of the drafted
decision 5, which had read `sum_value` straight off the cagg. *(a)* **The time
integral, recommended**: `avg × hours(window)`, so a kW point gives kWh;
`count` dropped, because `sample_count` counts readings, not events. *(b)* No
`sum` at all — the author writes `avg({kw}, today) * hours(today)`. *(c)* The
raw sample sum with an editor warning — a garbage number stays writable and
nothing at runtime refuses it. **Ruled (a)**; decision 5.

## Decision

### 1. `E4.1` becomes an umbrella with three children, and its dependants wait for the umbrella

| Child | Carries | ⭐ | Depends |
| --- | --- | --- | --- |
| `E4.1a` | `bms.calc_parameters` and `bms.calc_parameter_keys` (migration `0074`), the resolver, the admin screen, and `bms-calc-v3` with the `$key` reference (decisions 2, 3, 4) | ⭐ enabler — hands-on, serial, never a cold subagent | `F2.4` |
| `E4.1b` | The window functions, rolling and calendar, `bms.locations.timezone`, the cagg and raw reads in the evaluation host (decisions 5, 6) | — | `E4.1a` |
| `E4.1c` | The stock sustainability points, the deferral-ledger promotions, the tariff absorption and the DTO rename (decisions 7, 8) | — | `E4.1a`, `E4.1b` |

`E4.2` and `E4.3` keep `E4.1` in `Depends` and unblock **when the umbrella
closes**, not when `E4.1a` does — the rule ADR 0047 decision 1 set for `F3.1`.
`E1.6` likewise. Each child pays its own closure: `verify`, four review agents,
the §4.6 live-stack pass.

### 2. `bms.calc_parameters` — one table, nearest scope wins, effective-dated (migration `0074`)

A parameter is a **named number with a unit, a scope and a validity window**.

- `bms.calc_parameter_keys` — the vocabulary, on the ADR 0032 shape: `code`
  (the `$key` an author writes; catalog-code charset per ADR 0065), `label`,
  `unit`, `description`, seeded with the stock keys and extended by `INSERT`,
  never by a release. **Global, not per organization** (ruled without a
  question, item 1): a stock template that reads `$grid_carbon_factor_kgco2_per_kwh`
  must mean the same thing at every site it is instantiated at, which is ADR
  0049 decision 5's reason applied to a third vocabulary. The *value* is per
  organization; only the *name* is shared.
- `bms.calc_parameters` — `id`, `organization_id NOT NULL`, `key` (FK to the
  vocabulary), `location_id` nullable, `asset_id` nullable, **at most one of
  the two set** (a `CHECK` on the `dashboards_scope_check` pattern; both
  `NULL` is the organization scope), `value double precision NOT NULL`,
  `effective_from timestamptz NOT NULL`, `effective_to timestamptz` nullable
  with `CHECK (effective_to > effective_from)`, `created_at`, `updated_at`.
  `organization_id NOT NULL` + `FORCE ROW LEVEL SECURITY` + the tenant policy
  in the creating migration (ADR 0043, ADR 0045); writes stamp `audit_log`
  through `MasterDataAuditService`.
- **Resolution** for `$key` on an asset at instant *t*: the row whose scope is
  nearest — asset, then the asset's location, then the organization — among
  rows whose `[effective_from, effective_to)` contains *t*. Two rows of the
  same key and scope may not overlap in time; the write path refuses the
  overlap with a 409 inside one transaction (ruled without a question, item
  2).
- **Unset means no value.** A `$key` with no row in scope at *t* is a refusal
  with its own reason (`parameter_unset`): the engine writes nothing and
  increments the counter, exactly as ADR 0055 decision 11 rules for a null
  coverage ratio and ADR 0037 decision 9 rules for every refusal. There is no
  default value anywhere — not `0`, not `1`, not an env var. A missing carbon
  factor that produced a zero would be a wrong CO₂ figure on a board-level
  screen, which is the risk B14 named.
- **The stock keys** cover what SOW §7 and the deferral ledger name, with the
  naming rule *currency-neutral, unit-suffixed, `snake_case`*:
  `energy_tariff_per_kwh`, `water_tariff_per_kl`, `effluent_tariff_per_kl`,
  `grid_carbon_factor_kgco2_per_kwh`, `energy_baseline_kwh_per_day`,
  `water_baseline_kl_per_day`, `chemical_baseline_kg_per_day`, `rated_kw`,
  `installed_kwp`, `contract_demand_kva`, `tank_capacity_l`, `tariff_pf_band`.
  The exact list is fixed at the `E4.1a` plan gate; the naming rule is fixed
  here. **No stock key ships with a value** (Context 3).
- **The admin screen** `/admin/calc-parameters` lists, creates and edits
  parameters with a scope picker (organization · location · asset) and the two
  dates, gated as master data — the *forms*, not the buttons (ADR 0047
  Amendment 6's lesson, `F3.63`). A store no screen reaches is the `F3.1d`
  reachability defect, and it is `E4.1a`'s, not a later row's.

### 3. `bms-calc-v3` — a third dialect, a strict superset of `v2`, `scheduled` only

`CALC_DIALECTS` widens by one member, `"bms-calc-v3"`; `templateKpiSchema.dialect`
and `bms.template_points.formula_dialect` accept it. ADR 0055 decisions 2, 3
and 4 apply verbatim: **`v1` and `v2` keep their exact current meaning
forever**, no migration rewrites a stored formula, and **every `v2` expression
parses under `v3` and evaluates to the same number** — stated as a property
test over the `v2` corpus, not a handful of examples (`dialect-superset.test.ts`
is the shape). A `v3` formula is **`scheduled` only** (ADR 0055 decision 10's
reasoning, extended: a parameter read and a window read are both queries, and
a tick is the boundary they run against).

### 4. The `$key` reference — one new node kind

`$energy_tariff_per_kwh` tokenises as a parameter reference and parses to a
new `CalcParamRef` node (`kind: "param"`, `key`, `position`) — a new kind on
purpose, not an optional field on `ref`, for the reason `ast.ts:42` gives for
`qref`. The host resolves every `param` node before `evaluate()` runs, the way
it resolves `CalcCrossRef` today, so the pure evaluator stays pure. A formula
carries at most `MAX_FORMULA_PARAM_REFS` of them (ruled without a question,
item 9). The save-time validator refuses a key the vocabulary does not hold,
with an author-facing message; a key that exists but has no value in scope is
**not** a save-time error — it is decision 2's runtime refusal, because the
value is per organization and per date and the author of a stock template
cannot see either.

### 5. Window functions — five functions and one helper over one point reference

```
sum({kw}, today)          avg({kw}, 7d)            min({temp_c}, this_month)
max({kw}, 24h)            delta({kwh}, today)      hours(today)
```

- **Five functions plus one helper.** `avg`, `min`, `max` read the continuous
  aggregates (`sum_value / sample_count`, `min_value`, `max_value`).
  **`sum` is the time integral, not the sample sum** (ruled at Q6):
  `sum({kw}, today)` is `avg({kw}, today) × hours(today)`, in `<unit>·h` — a
  kW point gives kWh, and the author converts any other unit. The cagg's
  `sum_value` is a sum of raw samples that scales with the polling rate and
  means nothing physically — `reports.service.ts:191` already multiplies by
  the bucket width for exactly this reason — so it is **not** exposed, and
  there is no `count`: `sample_count` is how many readings arrived, never a
  count of events an author means. **`delta`** is last sample minus first
  sample inside the window, read from `point_values` itself (Context 5), and
  is the correct path from a cumulative meter (`kwh`, `kl`) to a period
  total. **`hours(window)`** is the elapsed hours the window covers — a
  calendar window's elapsed part, a rolling window's full duration — so a
  daily baseline can be prorated: `delta({kwh}, today) / ($energy_baseline_kwh_per_day * hours(today) / 24)`.
- **A window wraps one point reference** — the owning asset's `{kwh}` or a
  qualified `{TX_01.kwh}` — **never a scope aggregate** (ruled without a
  question, item 4). `sum({kw} @site, 24h)` does not parse. A site total over
  a window is two layers: a per-asset `kwh_today` tag, then `sum({kwh_today} @site)`,
  which ADR 0055 decision 7 already permits. This keeps each window read a
  single `(asset_id, point_key)` range scan and keeps decision 12's location
  containment untouched.
- **The existing names are reused, not shadowed.** `sum` and `avg` already
  exist as scope aggregates (`sum({kw} @site)`); the parser tells the forms
  apart by the second argument, which is a window literal here and absent
  there. `min` and `max` already exist as scalar functions of two or more
  numbers; a window form has exactly one point reference and one window
  literal. `CALC_FUNCTION_ARITY` and the aggregate table widen accordingly
  and the `v2` corpus must still parse identically (decision 3).
- **An empty window refuses.** A window with no sample writes nothing and
  increments the counter under its own reason (`window_empty`) — ADR 0037
  decision 9 again. `delta` with one sample is empty.
- **Rolling windows** are a duration literal `<n>(m|h|d)` ending at the
  tick's bucketed timestamp (ADR 0037 decision 8), capped at `366d` (ruled
  without a question, item 5).
- **View selection obeys the watermark, not only the bucket.** The policies
  in `0027` trail real time by their `end_offset` — 1 minute for `1m`, 10
  minutes for `5m`, 2 hours for `1h`, **2 days for `1d`** — and
  `materialized_only = false` fills the gap beyond a view's watermark by
  aggregating `point_values` on the fly, which is correct but is not free.
  The host therefore reads **the coarsest view whose bucket divides the
  window's boundaries *and* whose watermark has passed the window's end**,
  and composes finer buckets or raw rows for the remainder. Nothing in a
  `today` window ever comes from `point_values_1d`, and a `this_month` read
  that took `1d` alone would silently drop the last two days of the month —
  the guard `E4.1b` owes asserts a month-to-date value across that boundary.
- **`delta` is two index lookups, not a range scan.** First and last sample
  inside the window are `ORDER BY time ASC LIMIT 1` and `ORDER BY time DESC
  LIMIT 1` on `(asset_id, point_key, time)` — the shape ADR 0037 decision 3
  kept index-friendly — so `delta({kwh}, this_year)` costs the same as
  `delta({kwh}, 24h)` regardless of the window's length.
- **Staleness of a window** is not the staleness of its last sample.
  `max_input_age_seconds` (ADR 0037 decision 5) applies to the *latest*
  reading of the referenced point, as it does today; the window itself is
  simply the rows that exist. A meter that stopped at 10:00 still has a
  correct `delta({kwh}, today)` at 11:00 and is refused by the staleness rule
  at the same moment a `v1` formula over it would be.

### 6. Calendar windows and `bms.locations.timezone` (migration `0074`)

- **Four calendar windows**: `today`, `this_week` (Monday start),
  `this_month`, `this_year`, each the elapsed part of the current period in
  the **owning asset's location's timezone**, ending at the tick.
- **`bms.locations.timezone`** — an IANA zone name, `varchar(64)`, **nullable,
  no default** (ruled without a question, item 6). The seed sets the demo
  locations to `Africa/Johannesburg`; the location admin form gains the field,
  validated against the zone list the database already holds
  (`pg_timezone_names`). A default of `UTC` or `Asia/Kolkata` was considered
  and declined for the reason ADR 0031 Amendment 1 records against
  `assets.domain`'s dropped `DEFAULT`: a default that silently accepts makes a
  calendar total at a site nobody configured *look* right at the wrong hour.
- **A calendar window on a location with no timezone refuses**, under its own
  reason (`timezone_unset`), and the save-time validator warns when a template
  formula uses a calendar window — it cannot refuse, because the template does
  not know its sites.
- **Half-hour alignment is a test, not a comment.** IST midnight is 18:30 UTC;
  the calendar read composes `5m` buckets (Context 6), and the guard `E4.1b`
  owes asserts `delta({kwh}, today)` across an 18:30 UTC boundary at an
  `Asia/Kolkata` site against a hand-computed value.
- **A calendar tag resets.** `kwh_today` drops to its first-sample delta at
  local midnight. That is what the name promises; a rule that alarms on it
  must say so in its own threshold, and the `E4.1c` stock alarm set does not
  bind a calendar tag to a low threshold.

### 7. The Rand tariff is absorbed, and the DTOs stop naming a currency

Both `energyTariffZar()` sites go. `DashboardService` and `ReportsService`
read `energy_tariff_per_kwh` through the decision 2 resolver at the
organization scope (the location scope where the read is location-scoped),
effective at the query's *end* instant. `ENERGY_TARIFF_ZAR_PER_KWH` and the
`2.15` default are removed, and a test asserts the env var is not read
anywhere. The DTO fields become `indicativeCost` and `tariffPerKwh`, plus
`currency` — an ADR 0030 contract change, made once, in `E4.1c`. **A missing
tariff yields `null` cost fields, not `0`** (decision 2's rule at the read).

`bms.organizations.currency` — ISO 4217, `char(3)`, `NOT NULL`, backfilled
`ZAR` for the seeded demo organization in the same migration (its tariff *was*
Rand) and required on create thereafter (ruled without a question, item 7).
The web formats money with `Intl.NumberFormat` on that code; no library.

### 8. The stock content `E4.1c` authors

Per stock class, the derived points the ledger deferred on an attribute or a
window and which decisions 4–6 now express — exact list at the plan gate,
naming rule fixed here (`<quantity>_<window>` for a windowed tag). On the
incomer and feeder: `energy_cost_per_h` (`{kw} * $energy_tariff_per_kwh`),
`co2_kg_per_h`, `kwh_today`, `energy_cost_today`, `co2_kg_today`,
`energy_saving_vs_baseline_pct`; on the water meter classes: `kl_today`,
`water_cost_today`, `water_saving_vs_baseline_pct`; on the DG set:
`downtime_h_24h`, `availability_pct_24h`, `starts_per_day`; on the solar PV:
`co2_avoided_kg_today`, `performance_ratio_pct`, `specific_yield_kwh_kwp_day`.
The **model** class of the ledger (`hot_spot_estimate_c`,
`loss_of_life_pct_day`, `duval_triangle_zone`) stays deferred: no decision
here gives the grammar a thermal model. Each touched stock entry bumps its
`stockVersion` (ADR 0052 decision 6; ruled without a question, item 10).

### 9. What this ADR does not decide

- **Water Recycle % and Operational Efficiency %.** Not defined here, for
  Context 3's reason. Decisions 2–6 make them *authorable* by the client —
  a `v3` formula over their own meters and parameters — and `E4.2` is where
  they are shown. Nothing in `E4.1` ships either formula.
- **Cross-site benchmarking and enterprise roll-ups** — `E4.2`, on the
  read-time surface Context 8 names, over the tags this ADR stores.
- **Money on advisories** — `E1.6`, which now has a tariff to read.
- **Template KPI evaluation** — `F2.33` and the §5 *Template KPI evaluation
  surface* ⚠ are untouched; a `v3` KPI expression is stored and not evaluated,
  as `v1` and `v2` ones are today.
- **Chemical dosing meters** — `chemical_baseline_kg_per_day` is a key with
  nothing to compare against until a class declares a dosing counter (`E5.1`
  territory); the key exists so the baseline can be entered when it does.
- **Backfill.** ADR 0037 §"Not in this ADR": nothing recomputes history. A
  `v3` tag has values from the moment it is active.

## Ruled here without a question

Routine calls the drafting agent took so the plan can start; each is one line
to overturn at the plan gate.

1. Parameter key codes are global; values are per organization (decision 2).
2. Overlapping validity for one key and scope is refused at the write path with a 409; a `btree_gist` `EXCLUDE` constraint is a plan-gate option, not a §9.4 dependency (decision 2).
3. `v3` is `scheduled` only, as `v2` is (decision 3).
4. A window wraps one point reference, never a scope aggregate; a windowed site total is two layers (decision 5).
5. Rolling windows are `<n>(m|h|d)`, capped at `366d`; calendar windows are the four named; view selection obeys the cagg watermark; `delta` is two index lookups (decisions 5, 6).
6. `locations.timezone` is nullable with no default; the seed sets `Africa/Johannesburg`; a calendar window on `NULL` refuses (decision 6).
7. `organizations.currency` is ISO 4217, `NOT NULL`, backfilled `ZAR` for the seeded organization (decision 7).
8. Three new refusal reasons on the existing counter: `parameter_unset`, `window_empty`, `timezone_unset` (decisions 2, 5, 6).
9. `MAX_FORMULA_PARAM_REFS` and `MAX_FORMULA_WINDOWS` bound a formula, on the `MAX_FORMULA_CROSS_REFS` pattern; the numbers are the plan's (decisions 4, 5).
10. Every stock entry `E4.1c` touches bumps `stockVersion` (decision 8).

## Dependencies

None. No new npm package. Timezone arithmetic is Postgres `AT TIME ZONE` on
the read and `Intl` on the web; currency formatting is `Intl.NumberFormat`.
`btree_gist`, if item 2 chooses it, is a Postgres contrib extension enabled by
migration, not a manifest change.

## Consequences

- **`E4.1` moves `⬜` → `🟡` as an umbrella**; `E4.1a` ⭐, `E4.1b`, `E4.1c`
  are created `🟡`. Effort re-set `6–8` → `10–13` (`3–4` + `4–5` + `3–4`), and
  the increments are Q1 and Q2; each child re-sets its own at the plan gate.
- **It touches** `packages/db` (migration `0074`, schema, seed),
  `packages/shared` (`calc-dsl/`, contracts), `apps/api` (`calc/`,
  `admin/`, `dashboard/`, `reports/`, `admin/asset-templates/stock-catalog/`)
  and `apps/web` (the admin screen, the location form, the formula editor's
  validator, money formatting). Four reviewers at each close, `migration-reviewer`
  included for `E4.1a` and `E4.1b`.
- **`E4.1c` is serialised** with any row touching `stock-catalog/*.ts`
  (the `F3.2`/`F3.45` rule). Whichever lands second rebases.
- **The guards each child owes**, named so a closure can be checked against
  them: *`E4.1a`* — the `v2`-corpus superset property; a `param` node resolved
  asset-over-location-over-organization at three instants across an
  `effective_to`; `parameter_unset` refusing with a counter and **no row**; an
  RLS test **as `bms_tenant`** that a foreign organization's parameter is
  invisible; the overlap 409; the admin form gated as master data.
  *`E4.1b`* — each of the five functions and `hours` against a hand-computed
  window; `sum({kw}, 24h)` equal to `avg × 24` and **not** to the cagg's
  `sum_value`; `delta` reading raw across a cagg boundary; a `this_month`
  value that includes the two days behind the `1d` watermark; the IST
  18:30 UTC calendar test; `timezone_unset` and `window_empty` refusing; the `v2` corpus still
  parsing `sum({kw} @site)` unchanged. *`E4.1c`* — `ENERGY_TARIFF_ZAR_PER_KWH`
  read nowhere; `null` cost on a missing tariff; the DTO contract parsed by
  the web; the stock version bumps; every promoted formula parsing under `v3`
  and each of its keys present in the vocabulary.
- **`E4.2`, `E4.3` and `E1.6` unblock when the umbrella closes.**
- **`chore(agents):` sweep owed, separately** (§9.10): AGENTS.md's status
  line and its §2 calculation row gain this ADR. **No §6 line moves** — the
  ESG module is `E4.x`, not a §6 item.
- **`docs/roadmap.md`** mirrors the closure when the umbrella closes, not now.
- **A latency is accepted.** A `v3` value is at most one tick old (ADR 0055
  decision 10's bound), and a calendar tag is additionally up to one tick
  behind local midnight. The `F2.5` formula editor's dialect help must say so.
- **B14 stays open.** When the client answers, the answer lands as parameter
  rows through the decision 2 screen and, for the two KPIs, as `v3` formulas —
  never as a code change. That is the property this ADR exists to secure.

## Amendment 1 (2026-09-19) — three facts corrected at `E4.1b`'s closure

Ruled by the owner at the `E4.1b` plan gate ("amend at closure") and at the
PR 2 review. Decisions 5 and 6 above are left as written; this amendment is
the record of where the implementation measured them wrong or narrowed them.

1. **Decision 5's watermark sentence is false on this stack.** It says a
   `this_month` read "that took `1d` alone would silently drop the last two
   days of the month". Measured 2026-09-19 on the compose stack (PG 16.14,
   TimescaleDB 2.29.1): all four views run `materialized_only = false`, so
   the live branch serves every bucket beyond a view's watermark and a
   `1d`-only read drops nothing. The composition rule survives for two other
   reasons, recorded in `apps/api/src/calc/calc-window-plan.ts`: **alignment**
   (`time_bucket` without a zone makes every bucket UTC-aligned, so an IST
   day at 18:30 UTC or a SAST day at 22:00 UTC is never a whole number of
   `1h` or `1d` buckets — a `1d`-only read of an IST day answers
   `window_empty`) and **cost** (a month for one pair from `1m` is 1.1 s,
   from `5m` 121 ms, from `1h` 8–31 ms). The guard the row owed is kept as
   "a month-to-date value includes the rows behind the `1d` watermark"
   (`calc-windows.integration.spec.ts` W7a), which the live branch, not the
   composition, is what holds.
2. **Decision 6 names migration `0074`; the column shipped in `0075`.**
   `0074_calc_parameters.sql` was `E4.1a`'s and was frozen before `E4.1b`
   started (PR #497, `0075_location_timezone.sql`).
3. **A stalled refresh policy fails closed** (the PR 2 security review, ruled
   2026-09-19). Decision 5 bounds a formula (`MAX_FORMULA_WINDOWS`, `366d`)
   but not a stall: with the `1d` and `1h` policies stalled a `366d` read
   falls to `5m` (~105k buckets per pair per tick), and with all four stalled
   — this repository's orphaned `refresh_ranges` case — the part beyond the
   `1m` watermark is an on-the-fly aggregation of raw rows. Two budgets per
   aggregate read (`budgetDefect`): `MAX_WINDOW_BUCKETS = 20,000` and
   `MAX_LIVE_MINUTES = 180` of raw rows beyond the `1m` watermark (the `1m`
   policy's `start_offset`). A read over either is refused as
   **`windows_unresolved`** — ruling 8's third reason gains a fourth, the
   mirror of `parameters_unresolved` — with the watermarks in the warning,
   once per sweep. Three hours into a blocked refresh every aggregate window
   read stops fleet-wide; `delta` (two raw probes) and `hours` (no read) are
   unaffected. That is deliberate: a stalled policy stops the window
   formulas, never the database, and the warning is what surfaces the stall.

Two smaller facts, for completeness: the write path admits only a
`Region/City` zone (`LIKE '%/%'`, `posix/` and `right/` excluded — `EST` is a
fixed offset with no DST, `Factory` and `posixrules` are tzdata artefacts),
and the read path joins `pg_timezone_names` so a stored zone the server no
longer knows is `timezone_unset` rather than a thrown batch. `timezone` is
seed-owned like `latitude` (a re-seed re-asserts it), ruled at the PR 1
review; `ESK-DECOMM-01`, the access fixture, stays `NULL`.
