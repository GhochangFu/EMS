# ADR 0137 — Optimisation advisories with quantified benefits (`E1.6`)

## Status

**Accepted — 2026-11-17** (owner, in chat: "accept as recommended";
proposed the same day in PR #1394). Drafted by an agent for backlog row
`E1.6` at the step 2 gate (AGENTS.md §10, `docs/build-operating-model.md`).
Lines marked *(recommended)* were the drafter's calls; the owner accepted the
ADR with them as written, so **every *(recommended)* line is now a ruling**
and Q1–Q13 are ruled as recommended (see §Rulings).

Builds on [ADR 0134](./0134-slab-utility-tariffs.md) (slab tariffs, kVAh
billing), [ADR 0070](./0070-sustainability-metrics-engine.md) (calc
parameters: `energy_tariff_per_kwh`, `grid_carbon_factor_kgco2_per_kwh`,
`tariff_pf_band`, `contract_demand_kva`, `energy_baseline_kwh_per_day`; its
Amendment 7 hourly cost rule), [ADR 0037](./0037-calc-execution-engine.md)
(`F2.4`), [ADR 0135](./0135-ml-serving-foundation.md) Amendments 3, 5 and 8
(forecasts, anomaly scores and their advisory rules), [ADR 0108](./0108-trend-and-energy-views.md) Amendment 1
(`F4.299`, the Energy page's abnormal-consumption verdict), ADR 0133
(organization energy features) and [ADR 0030](./0030-shared-api-contracts.md)
(contracts).

**Why a new ADR and not an ADR 0135 amendment** *(recommended, **Q1**)*. Most
of an advisory is not ML: it is tariff, calc-parameter and meter arithmetic.
ML output enters only as context (anomalies) or as one later input (a kW
forecast). ADR 0135 is already about 1,900 lines and owns the scoring stack.
A separate ADR keeps the money rules in one place. It changes no ADR 0135
ruling (decision 9 says why).

*Numbering note.* `E1.8` is being scoped in a parallel session and may also
take 0137. Whichever ADR merges second takes the next free number.

## Context

`E1.6` is *"Optimisation advisories with quantified ₹/kWh/kL/CO₂ benefits"*
(P2, 10–14 person-weeks, wave 5). Its three dependencies are done: `E1.2`
anomalies ✅, `E1.4` forecasts ✅, `F2.4` calc engine ✅.

**What exists today, checked on `main` (`d57bfae`):**

| Need | What exists | Where |
|---|---|---|
| Energy price | Slab tariffs per location, per category, with `energy_unit` `kwh` or `kvah`; a flat `energy_tariff_per_kwh` parameter as the fallback | `packages/shared/src/tariffs/compute-bill.ts`, `apps/api/src/tariffs/energy-rate-resolver.ts`, `apps/api/src/telemetry/energy-cost.ts` |
| Cost of a past hour | kWh × the rate in force at the start of that hour (ADR 0070 Amendment 7) | `apps/api/src/telemetry/energy-cost-by-day.ts` (`readLocalHourEnergy`, `readEnergyCostByDay`) |
| CO₂ | Only the parameter `grid_carbon_factor_kgco2_per_kwh` (kg CO₂/kWh), per organization / location / asset, effective-dated, **no default** | `bms.calc_parameters` (migration `0074`) |
| Power factor | Meter points `pf`, `kw`, `kva`, `kvar`, `kvah_total`, `kwh_total`; the parameter `tariff_pf_band` ("PF threshold below which the tariff applies a penalty") is **read by nothing** | `stock-catalog/electrical-feeder.ts`, `0074` |
| Abnormal consumption | The Energy page's verdict: this period's kWh > **1.5 ×** the median of the **4** earlier same-length periods (at least **3** present) | `apps/api/src/reports/energy-abnormal.ts`, `packages/shared/src/contracts/energy-organization-views.ts` |
| Forecasts | Hourly Chronos-2 p10/p50/p90 for 48 h; `electrical/energy_meter/kw` is a target but **no PHEWB meter is eligible before about 2026-12-02** (56 days) | `ml.forecasts`, `apps/ml/src/bms_ml/targets.py` |
| Anomalies | Hourly scores, two detectors; `baseline_mad` marks about **7 %** of hours unusual against a ~1 % design; owner's read due about **2026-11-23** | `ml.anomaly_scores` |
| Currency | `bms.organizations.currency` (`char(3)`); tariff rates are in it | `bms-schema.ts` |

**What does not exist, and shapes the first slice:**

1. **No time-of-day (ToD) tariff.** No peak or off-peak rate is modelled
   anywhere. A slab tariff gives one blended rate per month (bill ÷ units).
   So moving kWh from one hour to another **changes no ₹ figure the system
   can compute**. A "shift load out of the peak tariff" advisory with a ₹
   benefit is not possible until ToD rates exist.
2. **No PF penalty or rebate rate.** ADR 0134 left PF/LF rebates out of
   scope. The only PF money the system can compute is on a **kVAh-billed**
   tariff: there the bill is on kVAh, and a better PF lowers kVAh for the same
   kWh.
3. **No excess-demand penalty.** ADR 0134 decision 6 prices the fixed charge
   on sanctioned load, not on recorded maximum demand. So a demand peak above
   `contract_demand_kva` has no ₹ in the system.
4. **No emission factor by default.** Without the parameter there is no CO₂
   figure; there is no built-in grid factor.
5. **The template `optimisation` section is still refused.**
   `RESERVED_SECTIONS` rejects it with "reserved for E1.6" ([ADR 0019](./0019-template-content-model.md),
   AGENTS.md §6). ADR 0019 gives it no shape.
6. **No advisory table, module or route** exists.

**The demo host is small.** A shared t4g.large (2 vCPU, ~7.6 GiB, swap full);
the `ml` container is limited to 1 vCPU / 1 GiB and its hourly cycle must stay
≤ 300 s (Amendment 5 ruling 5). Most real energy data is the 5 PHEWB energy
meters; most other energy assets are simulated.

## Decision

### 1. Three advisory kinds, energy only *(recommended, **Q2**)*

| Kind | Code | Trigger | Benefit shown | Built in |
|---|---|---|---|---|
| Low power factor | `low_power_factor` | 7-day energy-weighted PF below the threshold | kVAh avoidable; **₹ only on a kVAh-billed tariff**; kVAr of correction | `E1.6a` |
| Consumption above baseline | `excess_consumption` | last 7 days' kWh above the baseline by the Energy page's own rule | kWh, ₹, kg CO₂ | `E1.6a` |
| Forecast demand near contract | `demand_near_contract` | next 48 h forecast kVA above 90 % of `contract_demand_kva` | kVA headroom; **no ₹** (no excess-demand rate exists) | `E1.6c`, after PHEWB `kw` forecasts are live |

**Not in the first slice, each its own later row and gate:** a ₹ load-shift
advisory (needs ToD rates first: an ADR 0134 amendment and a tariff row);
water (kL) and chemical-dosing advisories; any HVAC or cold-room setpoint
advice. The row's `kL` part is therefore deferred, not dropped.

### 2. How each benefit is computed *(recommended, **Q3**)*

Common rules:
- **Window.** The last **7 complete local days** in the asset's location
  zone (ADR 0070 `timezone_unset` applies: no zone, no advisory).
- **Only real assets.** An asset is considered only when its RTU has
  `ingest_enabled`, the same rule as the ML targets. Simulated data never
  produces a money figure *(recommended, **Q4**)*.
- **Hourly energy and price** come from the existing reads, not new SQL:
  `readLocalHourEnergy` for kWh per hour, the `EnergyRateResolver` series and
  `parameterValueAt` for the rate in force at each hour (ADR 0070 Amendment
  7). A missing rate gives **no ₹ figure**, never a guessed one; the kWh and
  CO₂ lines still show.
- **CO₂** = kWh × `grid_carbon_factor_kgco2_per_kwh` in force. Unset → no CO₂
  line, and the assumptions say "no grid emission factor set".
- **Projection.** Each advisory shows the 7-day figure and a **30-day figure =
  7-day × 30/7**, labelled "if the last 7 days repeat". No annual figure.
- **Rounding.** ₹ to the nearest whole unit of the organization's currency,
  kWh and kVAh to whole numbers, kg CO₂ to whole numbers, PF to 2 decimals.

**`low_power_factor`** (an `electrical` asset with `kw` and `pf`, or `kw` and
`kva`):
- 7-day PF = Σ kWh ÷ Σ kVAh, from `kwh_total` / `kvah_total` deltas when both
  exist; otherwise Σ hourly mean `kw` ÷ Σ hourly mean `kva` over the hours
  where both exist (marked *estimated*).
- Threshold = `tariff_pf_band` at the asset's scope; unset → **0.95**, shown
  as an assumption.
- Target PF for the benefit = **0.99** (a fixed assumption, shown).
- Avoidable kVAh = Σ kWh ÷ PF − Σ kWh ÷ 0.99.
- ₹ = avoidable kVAh × the hourly rate, **only when the meter's location
  tariff has `energy_unit = kvah`**. On a kWh tariff the line reads "Your
  tariff bills kWh; a PF penalty is not modelled, so no ₹ is shown."
- Correction size = mean kW × (tan φ₁ − tan φ₂), where φ₁ = arccos(PF) and φ₂ = arccos(0.99), shown as "about N kVAr
  of correction".
- No CO₂ line (line losses are not modelled).

**`excess_consumption`** (an asset with energy, the Energy page's set):
- Baseline = `energy_baseline_kwh_per_day` × 7 when that parameter is set at
  the asset's scope ("your baseline"); otherwise the median of the 4 earlier
  7-day windows, at least 3 present ("own history"). Same constants as
  `F4.299` (`ABNORMAL_RATIO`, `BASELINE_WINDOWS`, `MIN_BASELINE_WINDOWS`),
  imported, never restated, so the Energy page and the advisory never
  disagree.
- Trigger = 7-day kWh > `ABNORMAL_RATIO` × baseline.
- Excess kWh = 7-day kWh − baseline. ₹ = excess kWh × the 7-day
  kWh-weighted average rate. CO₂ = excess kWh × the factor.

**`demand_near_contract`** (`E1.6c`):
- Forecast kVA per hour = forecast p50 `kw` ÷ the 7-day PF.
- Trigger = any hour in the next 48 h above **90 %** of `contract_demand_kva`
  (parameter must be set; unset → no advisory).
- Shows the hour, the forecast kVA, the contract kVA and the headroom. No ₹.
- Uses only the latest succeeded, non-stale forecast (Amendment 3 C3).

### 3. Confidence and assumptions on screen *(recommended, **Q5**)*

- **One label per advisory**, never a percentage: *Measured* (every input is
  from the meter and the configured tariff/parameters), *Estimated* (any
  input is assumed or derived: the 0.95 default, PF from kW/kVA means, a
  baseline from own history), *Forecast-based* (`demand_near_contract`).
- **An "Assumptions" list** on every advisory: the window and zone; the rate
  and where it came from (tariff name and version, or the parameter's scope
  and effective date); the emission factor and its scope; the threshold and
  the target PF; the projection rule.
- **Wording.** Every advisory carries the *Advisory* pill
  (`StatusPill tone="info"`), never a severity colour, and the line "An
  estimate from the last 7 days, not a guaranteed saving." No accuracy
  figure.

### 4. Anomalies are context only *(recommended, **Q6**)*

An anomaly score **never** creates an advisory and **never** changes a
number in one. On `excess_consumption`, a context line says how many unusual
hours the asset had in the window, with the ADR 0135 Amendment 8 wording:
Baseline-only marks are a **weak signal**; marks from both methods are the
strongest. This stays true until the owner rules on the detector after the
one-week read (about 2026-11-23); no threshold changes here.

### 5. Where advisories appear *(recommended, **Q7**)*

- (a) An **Advisories** page, route `/advisories`, in *Operations* after
  *Anomalies*, with a Lucide icon no other item uses (AGENTS.md §5). The
  existing list language: `PageHeader`, the shared `ScopeFilterBar`
  (organization + location, as `/alarms`), and a `SectionCard` per
  advisory: asset (linked to its history page), kind, headline benefit (7-day
  and 30-day), confidence label, *Advisory* pill, the assumptions list folded
  under a disclosure. Sorted by 30-day ₹ (then kWh) descending; unpriced
  advisories after priced ones.
- (b) The same cards, for one asset, in a section on
  `/asset-history/:assetId`.
- **No dashboard widget** in this ADR; one is a later row if wanted.
- Empty state: "No advisories. An energy meter gets advisories when it has
  real data, a tariff or rate, and 7 complete days."

### 6. Access and gating *(recommended, **Q8**)*

- Rows are filtered by `readableAssetIds` on both branches of
  `withReadScope` (ADR 0135 Amendment 3 S1). Every signed-in user who can
  read the asset sees its advisories, the same audience that already sees
  its cost and CO₂ calc points.
- An organization whose ADR 0133 energy features resolve **off** gets no
  energy advisories.
- Money is shown in the organization's `currency`; the `₹` symbol only when
  it is `INR`.

### 7. No LLM wording *(recommended, **Q9**)*

Advisory text is fixed sentences built by pure functions. The ADR 0135
Amendment 8 LLM path is **not** used here: a paragraph about money is a
riskier thing to let a model word, and E1.9's guard is built for counts, not
currency. A later row may add it under its own gate.

### 8. Advisory only *(recommended, **Q10**)*

No advisory raises an alarm, sends a notification, opens or suggests a work
order, enters a report, a schedule, an export, the copilot chat or a copilot
tool. There is no acknowledge, dismiss or "done" state: an advisory is
recomputed on each read and disappears when its trigger no longer holds.
Tracking claimed savings (measurement and verification) is a later row.

### 9. Compute placement: read-time in the API *(recommended, **Q11**)*

- A new NestJS module, `apps/api/src/advisories/`, computes advisories **when
  a page asks**, from existing tables. Pure functions do the arithmetic; one
  reads file does the SQL.
- **No `apps/ml` change**, no Python job, no new container, no change to the
  hourly cycle or its 300 s budget, no `ml` schema change.
- **No new table and no migration** for `E1.6a`/`b`. No cache (caching is
  unpromoted, AGENTS.md §9 rule 7); the web refetches every 15 min.
- Bounded reads: 35 days (7 + 4 × 7) of `_1h` for the assets in scope,
  capped at **200 assets per request** (more → the 200 with the highest 7-day
  kWh, and a "showing 200 of N" line). The plan proves the cost with `EXPLAIN
  (ANALYZE, BUFFERS)` on the demo host.
- Reading forecasts and anomaly scores goes through the existing `ml` read
  services (ADR 0135 Amendment 3 / 5). This is **not** one of the surfaces
  Amendment 3 R-g and Amendment 5 ruling 4 forbid (alarm, notification,
  report, export, copilot answer), so no ADR 0135 ruling is reversed. The
  advisories module writes nothing.
- It does **not** touch `E1.9`'s files (`apps/api/src/ml/ml-findings.*`, the
  findings web components) or `E1.8`'s.

### 10. The template `optimisation` section stays refused *(recommended, **Q12**)*

Kinds, thresholds and targets come from code constants and existing calc
parameters, not from template content. `RESERVED_SECTIONS` keeps refusing
`optimisation`; it reopens when a per-class advisory setting is actually
needed, under its own amendment. AGENTS.md §6 is unchanged.

### 11. PR split *(recommended, **Q13**; the plan confirms)*

| Child | What | Size |
|---|---|---|
| `E1.6a` | API: contracts (`packages/shared/src/contracts/advisories.ts`), pure engine for `low_power_factor` and `excess_consumption`, reads, `GET /advisories` (organization + location filter) and `GET /assets/:assetId/advisories` | 2–3 |
| `E1.6b` | Web: `/advisories` page and nav item, the asset-history section | 1–2 |
| `E1.6c` | `demand_near_contract`, after PHEWB `kw` forecasts have run for a week (about 2026-12-09) | 1–2 |

`E1.6` closes when `a`–`c` are done. The rest of the row's 10–14 weeks moves
to new rows, each with its own gate: ToD load shift (with a tariff ToD
amendment), water kL, chemical dosing, LLM wording, a widget, savings
tracking.

## Dependencies

No npm or Python package. No migration in `E1.6a`–`c`. No new environment
variable.

## Consequences

- The first ₹ figures are narrow on purpose: PF only on kVAh-billed meters,
  and consumption above baseline. A customer on a kWh tariff with a PF
  penalty sees the kVAh and kVAr figures but no ₹ until PF penalties are
  modelled.
- On the demo host today only the PHEWB energy meters qualify, and only if
  their locations have a tariff or `energy_tariff_per_kwh` and a timezone.
  The plan's demo-host checks read that first.
- Read-time compute means no history of past advisories. If savings tracking
  is wanted later, it needs a table and its own ADR.
- **Follow-ups owed:** the `chore(agents):` catch-up after closure (§2 gains
  the advisories module; §6's `optimisation` line is unchanged); new backlog
  rows for the deferred kinds.

## Open questions for the owner (all ruled 2026-11-17)

Each had a recommended answer; the owner accepted all of them (§Rulings).

1. **Q1 — Form.** New ADR 0137, not an ADR 0135 amendment. *Recommended:
   yes* (most of it is tariff arithmetic, not ML).
2. **Q2 — First kinds.** `low_power_factor` and `excess_consumption` now,
   `demand_near_contract` after `kw` forecasts are live; ₹ load shift, water
   and chemical later as their own rows. *Recommended: yes.* (Alternative:
   first add ToD rates to tariffs so a ₹ load-shift advisory is possible;
   that is a tariff change of its own, about 2–3 weeks, before any advisory.)
3. **Q3 — Formulas.** As in decision 2: 7-day window, 30-day projection, PF
   threshold `tariff_pf_band` else 0.95, target PF 0.99, the `F4.299`
   baseline rule, `energy_baseline_kwh_per_day` wins when set, no ₹ without
   a configured rate. *Recommended: yes.*
4. **Q4 — Real assets only.** Simulated assets never get advisories.
   *Recommended: yes* (a money figure from simulator formulas would mislead;
   it matches the ML rule). The cost: few advisories on the demo host.
5. **Q5 — Confidence.** Three labels (*Measured*, *Estimated*,
   *Forecast-based*) plus an assumptions list; no percentage, no accuracy
   figure. *Recommended: yes.*
6. **Q6 — Anomalies as context only**, with the weak-signal wording.
   *Recommended: yes.*
7. **Q7 — Surfaces.** `/advisories` page plus the asset-history section; no
   widget for now. *Recommended: yes.*
8. **Q8 — Access.** Whoever can read the asset; hidden when the
   organization's energy features are off. *Recommended: yes.*
9. **Q9 — LLM wording.** No. *Recommended: no LLM in E1.6.*
10. **Q10 — Reach.** Advisory only: no alarm, notification, work order,
    report, export or copilot; no dismiss state. *Recommended: yes.*
11. **Q11 — Compute.** Read-time in a new `apps/api/src/advisories/` module;
    no `apps/ml` change, no table, no migration, 200-asset cap.
    *Recommended: yes.*
12. **Q12 — Template `optimisation` section** stays refused. *Recommended:
    yes.*
13. **Q13 — PR split** `E1.6a` (API) → `E1.6b` (web) → `E1.6c` (forecast
    kind); the rest of the row becomes new rows. *Recommended: yes.*

## Rulings

**2026-11-17, owner, in chat: "accept as recommended".** Q1–Q13 are ruled as
recommended. The build waits for the step-3 plan
(`docs/plans/e1.6-optimisation-advisories.md`) and the owner's yes to it.
