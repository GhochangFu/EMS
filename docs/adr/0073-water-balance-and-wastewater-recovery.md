# ADR 0073 — Water balance and wastewater recovery (`E4.3`)

## Status

Accepted — drafted at the §10 gate on 2026-09-23, before any implementation
code. Seven gate questions were put to the owner one at a time; five were
ruled as recommended and **two against the recommendation** — Q1 (fold the
double count into this row rather than open a row and label it now) and Q6
(seed demo water assets rather than a removed fixture). Q7 corrected the
balance formula that the Q5 option text stated. The rulings are recorded
under *Gate questions* and carried into *Decision*. One point was decided
without a question and is listed under *Ruled here without a question*.
The owner merged this record on 2026-09-23 (PR #530).

Promotes nothing out of `AGENTS.md` §6 — the ESG module is `E4.x`, not a §6
item (ADR 0070 *Consequences*, ADR 0072 *Status*).

## Context

**The row is a title and nothing else.** `docs/BACKLOG.md` carries `E4.3` as
*Water-balance / wastewater-recovery analytics*, P2, wave 5, `Depends` `E4.1`
and `E5.1`, both ✅. No scope note, no acceptance criteria, and no ADR names
what "balance" means. ADR 0072 decision 6 says only that water balance is
`E4.3` and not `E4.2`. The §8.2 comparison maps sheet rows 4 (*Unified energy
& water view*) and 15 (*Optional ESG module*) onto it.

**What the water pack gives us** (`E5.1`, ADR 0040;
`packages/shared/src/constants.ts` `WATER_CLASS_POINT_KEYS`). Six classes, each
with measured flow rates in `klh`:

| Class | Inlet | Outlet | Other |
|---|---|---|---|
| `water-wtp` | `raw_water_flow_klh` | `treated_water_flow_klh` | derived `recovery_pct` |
| `water-ro` | `feed_flow_klh` | `permeate_flow_klh` | `reject_flow_klh`; derived `recovery_pct` |
| `water-softener` | `inlet_flow_klh` | `outlet_flow_totalizer_kl` (a totalizer, not a rate) | — |
| `water-cooling-tower` | `makeup_flow_klh` | `blowdown_flow_klh` | `circ_flow_klh`; derived `makeup_pct` |
| `water-stp` | `influent_flow_klh` | `effluent_flow_klh` | `ras_flow_klh` |
| `water-etp` | `influent_flow_klh` | `discharge_flow_klh` | — |

`E4.1c` put `kl_today`, `water_cost_today` and `water_saving_vs_baseline_pct`
on all six classes, each over **that class's own inlet** (owner ruling Q5 of
the `E4.1c` plan gate). `E4.2` PR 2 added `kl_this_month`, `kl_this_year`,
`water_cost_this_month` and `water_cost_this_year`, on the same inlets.

**The shipped Sustainability Overview double-counts water.** Found at this
gate. `sustainability-overview` v3 binds its *Water today / this month / this
year* tiles and the *Benchmark by site* table to `sustainability.total` /
`sustainability.by_location` with `{ pointKey: "kl_*", aggregate: "sum" }`
(`apps/api/src/admin/dashboard-templates/stock-catalog.ts`). The roll-up sums
the point over **every** carrying asset in scope. In a series plant — WTP
treated water feeds the RO, RO permeate feeds cooling-tower makeup — the same
water is counted once per stage. STP and ETP influent is wastewater from the
site's own use, and it is added to intake as well. The water-cost tiles have
the same fault, mitigated only where an admin left `water_tariff_per_kl`
unset on the STP (`water-stp.ts`). No ADR, plan or tile label states the
limit. No demo organization has a water asset, so the running stack does not
show the fault today. The owner ruled (Q1) that the fix belongs to this ADR
rather than to a separate row.

**There is no plant topology.** Assets relate to locations only
(`assets.location_id`, ADR 0008). `F2.10` (asset parent/child) is ADR-gated
and not started. `bms-calc-v3` can read another asset's point
(`{ASSET_CODE.point_key}`, ADR 0055), but nothing records which asset feeds
which, so a formula would hard-code asset codes per plant.
`asset_group_members.role` (`F3.37`, ADR 0049) holds layout words
(`raw-intake`, `treatment`, `distribution`) that place a widget in a section
template; it is not a hydraulic statement, and it exists only inside one
asset group.

**B14 is still open.** `docs/ion-exchange-response-form-2026-08-22.md` says we
will *draft* the Water Recycle % and Operational Efficiency % definitions for
the client's sign-off. ADR 0070 decision records that the answer "lands as
parameter rows and `v3` formulas, never as a code change". ADR 0072 decision 4
seeded `water_recycle_pct` with no formula; its tile is empty by design.

**The STP/ETP ruling stands.** `E5.1`'s owner ruling — no hydraulic
`recovery_pct` on the STP or ETP, because "the STP's own derived quantity is
reuse, and hydraulic recovery shown where an operator expects reuse is the
silent-wrong class of failure" (`constants.ts`) — is not re-opened here.

**No demo water.** No ESKOM or PHEWB asset is a water class, and `apps/sim`
emits no water telemetry.

## Gate questions

1. **The double count — separate row, fold into `E4.3`, or record only?**
   Recommended: a new row plus a label caveat now. **Ruled: fold into
   `E4.3`** — against the recommendation. No separate row and no label change
   now; decision 2 is the fix.
2. **What marks an asset's place in the balance?** Options: a per-asset
   balance role (new vocabulary and column), the `F3.37` group-member role,
   a fixed rule by class, or wait for `F2.10`. **Ruled as recommended: a
   per-asset balance role.**
3. **What do the shipped water tiles sum once the role exists?** Options:
   intake-role assets only, intake else all, or unchanged. **Ruled as
   recommended: intake-role assets only.**
4. **Water Recycle % (B14).** Options: draft it in this ADR for the client and
   ship nothing, or say nothing. **Ruled as recommended: draft here, ship
   nothing.**
5. **Where do the balance figures appear?** Options: a new catalog entry on
   the Sustainability section, a separate Water Balance dashboard, or point
   keys only. **Ruled as recommended: a new catalog entry on
   `sustainability-overview`.**
6. **Live-stack verification.** Options: a removed fixture on the `:4001`
   local-auth API, permanent demo water assets in the seed, or N/A by gate.
   Recommended: the fixture. **Ruled: seed demo water assets** — against the
   recommendation.
7. **The balance formula.** The Q5 option text said "intake + reuse −
   discharge"; the question put the correction. **Ruled as recommended:
   Intake − Discharge**, with Reuse as its own column.

## Decision

### 1. A per-asset water balance role (Q2)

- New global lookup vocabulary **`bms.water_balance_roles`** (`code`
  primary key, `label`, `sort_order`, `active`, `created_at`) — the
  `bms.asset_roles` shape and grant pattern from migration `0051`. Seeded by
  the migration, not by `seed.ts`: `intake`, `discharge`, `reuse`,
  `internal`.
- New nullable column **`bms.assets.water_balance_role varchar(64)`**
  referencing it. **`NULL` means "not in the balance"** — no default, because
  a default is a claim (the reason `0029` dropped `assets.domain`'s).
- The meaning of each role, per asset:
  - `intake` — the asset's **inlet** crosses the site boundary inward.
  - `discharge` — the asset's **outlet** leaves the site.
  - `reuse` — the asset's **outlet** returns to use on the site.
  - `internal` — the asset is inside the plant; neither flow crosses the
    boundary.
- One role per asset. An STP whose effluent is partly reused and partly
  discharged cannot be split; that is a recorded limitation, and `F2.10`'s
  topology is where a split would live.
- An admin sets it through the existing asset write path
  (`/api/v1/admin/assets`) and the asset form. It is not a template field:
  the same class is `intake` on one site and `internal` on the next.
- The vocabulary is served with the others at `GET /api/v1/vocabularies`
  (the `F4.45` pattern), not hard-coded in `apps/web`. No admin CRUD route
  like `/api/v1/admin/vocabularies/asset-roles` is built: the four codes are
  the balance's own arithmetic, and a fifth code would need a decision on
  which column it feeds.

### 2. The water tiles sum intake only (Q1, Q3)

- `sustainability.total` and `sustainability.by_location` gain an **optional**
  write-schema field **`balanceRole`** (a code from decision 1). When it is
  present, the carrying assets are those whose `water_balance_role` equals it;
  coverage (`fresh`, `carrying`) is counted over that set.
- `sustainability-overview` **v4** sets `balanceRole: "intake"` on the three
  `kl_*` tiles, the three `water_cost_*` tiles and the benchmark table. A site
  where no asset is `intake` shows an empty tile with `0 of 0` coverage — the
  honest answer until an admin sets a role.
- A tenant that imported v3 takes the fix by re-import, as with v3.

### 3. One new catalog entry: `water.balance` (Q5)

- A **dataset** entry, one row per location that owns at least one asset with
  a balance role in the resolved scope, in `code` order — the
  `sustainability.by_location` row rule.
- Write-schema params: `{ period: "today" | "this_month" | "this_year" }`.
- Columns, each a sum over the location's assets with that role:
  - **Intake** — the asset's `kl_<period>`.
  - **Reuse** — the asset's new `outlet_kl_<period>` (decision 4).
  - **Discharge** — the asset's new `outlet_kl_<period>`.
  - **Consumed or lost** — Intake − Discharge (Q7). Reuse is water that
    already entered as intake and goes round again, so adding it counts it
    twice — the fault this ADR removes.
  - **Coverage** — `n/m` over the location's role-carrying assets.
- Freshness and the latest-sample rule are `sustainability.*`'s (ADR 0072
  decision 2). A window sum below 90 % coverage already refuses as
  `window_sparse` (ADR 0070 Amendment 3), so a sparse period is absent rather
  than wrong.
- `catalog_key` is a closed vocabulary frozen by a CHECK (`0054`); the key is
  added by a migration that widens `dashboard_widget_sources_catalog_key_check`
  — the `0079` precedent — together with `metricCatalogKeySchema`.
- `sustainability-overview` v4 gains one table, *Water balance by site*,
  bound to `water.balance` with `period: "this_month"`. 18 + 1 = 19 widgets,
  inside `MAX_DASHBOARD_WIDGETS` (40).

### 4. Outlet volume codes on the six water classes

Three new derived codes on every water class, `bms-calc-v3`, one per period:
`outlet_kl_today`, `outlet_kl_this_month`, `outlet_kl_this_year`, unit `KL`.

| Class | Formula (`<w>` = `today` / `this_month` / `this_year`) |
|---|---|
| `water-wtp` | `sum({treated_water_flow_klh}, <w>)` |
| `water-ro` | `sum({permeate_flow_klh}, <w>)` |
| `water-softener` | `delta({outlet_flow_totalizer_kl}, <w>)` |
| `water-cooling-tower` | `sum({blowdown_flow_klh}, <w>)` |
| `water-stp` | `sum({effluent_flow_klh}, <w>)` |
| `water-etp` | `sum({discharge_flow_klh}, <w>)` |

The RO's `reject_flow_klh` is not an outlet here: the RO is `internal` on any
site where its reject goes to the ETP, and the ETP's discharge counts it.

### 5. Water Recycle % — drafted for the client, not shipped (Q4)

The draft put to the client for B14 sign-off:

> **Water Recycle %** = Reuse ÷ (Intake + Reuse) × 100, over one period and
> one site — the share of the water supplied to use that came from the site's
> own treated wastewater. Reuse and Intake are the `water.balance` columns of
> decision 3.

Nothing computes it. `water_recycle_pct` keeps no formula and its tile stays
empty. When the client signs, the answer lands as data, per ADR 0070.
Operational Efficiency % is not a water quantity and is not drafted here.

### 6. Demo water plant in the seed (Q6)

- The ESKOM seed gains one water plant at one location: a WTP (`intake`), an
  RO (`internal`), a cooling tower (`internal`), an STP (`reuse`) and an ETP
  (`discharge`), instantiated from the stock templates.
- `apps/sim` emits their flow points, so the balance and the v4 tiles have a
  live positive on the running stack.
- `verifyHierarchySeed`'s exact ESKOM counts rise with it, in the same
  commit; `compose up` re-seeds and verifies on every boot, so a wrong count
  stops the stack.

## Ruled here without a question

1. **`balanceRole` is an explicit parameter, not a filter keyed on the point
   code.** A filter that fires for `kl_*` only is invisible to a tile author.
   The cost: a hand-authored `kl_*` tile without `balanceRole` still sums
   every inlet. That is recorded, and the builder's help text says so.

## Dependencies

None. Nothing under §9.4 moves.

## Consequences

- **Schema:** `bms.water_balance_roles`, `bms.assets.water_balance_role`, and
  a widened `catalog_key` CHECK. `migration-reviewer` applies.
- **Touched:** `packages/db` (migrations, ESKOM seed, verify counts),
  `packages/shared` (vocabulary, catalog key schema, outlet codes,
  `UNIT_BY_KEY`), `apps/api` (asset write path, roll-up filter, new catalog
  entry, stock templates v4, six water classes), `apps/web` (asset form,
  vocabulary, table rendering), `apps/sim` (water flows).
- **Until an admin sets roles, the water tiles are empty on a real tenant.**
  That replaces a wrong number with no number, on purpose.
- **Split flows are not modelled** — one role per asset (decision 1).
- **The drafted Recycle % goes to the client** through the B14 channel; the
  response form still owes it.
- **`F2.10`** stays the home of real asset-to-asset topology. When it lands,
  the balance role can be derived from it, and this column retired.
- The PR split and unit order are the plan's (`plan-architect`).

## Amendment 1 (2026-09-24) — what the build measured, and the rulings it needed

Written at the row's closure. The decisions above are left as written; this is
the record of where the plan
(`docs/plans/e4.3-water-balance-and-wastewater-recovery.md`), its twelve
owner rulings of 2026-09-23 (Q1–Q12, all as recommended; C1–C8 are the plan's
contradictions table) and the reviews of the six pull requests corrected,
narrowed or sharpened them. The build ran as three serial PRs, each with a
post-merge sweep (Q12): #531 / #533, #534 / #535, #536 / #537.

1. **The *Context* sentence "the water-cost tiles have the same fault" is
   false as written, and decision 2 names widgets that do not exist** (C1,
   Q1). `sustainability-overview` v3 has no `water_cost_*` tiles — its cost
   tiles are `energy_cost_*`. v4 sets `balanceRole: "intake"` on the four water
   bindings v3 has: the three `kl_*` tiles and the benchmark table (#534).

2. **The role order is decision 1's, and it did not change.** Decision 1 lists
   `intake`, `discharge`, `reuse`, `internal`; `0080` seeds them in that order
   (`sort_order` 10–40). The plan's U1/U2 text used another order (`intake`,
   `internal`, `reuse`, `discharge`); the owner ruled to keep `0080`'s, and the
   plan's order was not adopted (#531).

3. **Decision 4 has no softener row** (C2, Q2). `outlet_flow_totalizer_kl` is
   *treated volume since regeneration* and resets, so `delta()` over a window
   holding a regeneration under-reports or goes negative, and `delta` sits
   outside the `window_sparse` guard. The softener carries no outlet codes and
   stays at stock v4; the WTP, RO, cooling tower, STP and ETP carry the three
   `sum` rows at **v5** — the classes were at v4 before `E4.3`, not v3 (C7)
   (#534).

4. **Decision 6's demo plant is a mirror, not a stock import** (C3, Q3, Q10,
   Q11). `packages/db` cannot import the stock catalog in `apps/api`, and the
   seed runs before the API exists. Read decision 6's first bullet as: the
   ESKOM seed gains one water plant at **CSMOC Gauteng** on seed-side mirror
   templates `DEMO-WATER-<CLASS>` v1 (`stock_code` and `stock_version` NULL),
   whose formulas `tests/e4.3-demo-water-plant.test.ts` holds byte-equal to the
   stock modules. The mirrors carry the flows the formulas read plus the six
   volume rows `kl_*` / `outlet_kl_*` — 40 template points; `water_cost_*`,
   `water_saving_vs_baseline_pct`, `recovery_pct` and the alarm and health
   content are omitted (#536). *Context*'s "no demo water" is no longer true.

5. **Decision 6's "exact ESKOM counts rise" had no count to rise** (C4, Q7).
   `verifyHierarchySeed` pinned no ESKOM asset total, so four exact counts were
   added: roled 5, on the demo templates 5, intake 1, water-group members 5.
   Owner ruling R1 (#536, migration review M1) scoped them to the five `WTR-*`
   demo codes, because a domain-wide count let one admin-created water asset,
   or a leaked fixture, stop `migrate` and every service behind it. The #537
   sweep pairs each demo asset with its own template code.

6. **The seed and the simulator had no water path** (C8, Q4). `water` had no
   entry in `DOMAIN_RTU_SUFFIX` (seeding a water asset threw) and no simulator
   branch (a water asset would have emitted electrical keys). `water: "WATER"`
   was added — eleven `SIM-RTU-<site>-WATER` RTUs, ten of them empty — with a
   `water` branch in `demoGroupCodesForAsset` and `stepWater` in `apps/sim`
   (#536).

7. **The v4 table's `this_month` shows nothing on a new stack** (C5, Q5).
   Under ADR 0070 Amendment 3 a window `sum` below 90 % coverage refuses as
   `window_sparse`, so the stock table reads `null` cells and `0/3` until the
   first of the month after the boot. That is the expected state, not a
   failure.

8. **The help sentence of *Ruled here without a question* reaches one editor
   only** (C6, Q6). It is in the presentation description, the write schema's
   `.describe()`, and a note in the template `WidgetEditor` for a `kl_*` source
   without `balanceRole` — never for an energy or CO₂ key (#534). Two gaps
   remain: the dashboard builder's `WidgetInspector` shows no note for the same
   binding, and a role-less `outlet_kl_*` total sums the reuse, discharge and
   internal outlets together with no note anywhere. Both are backlog row
   `F4.152`.

9. **Decision 3's `consumed` rule is stricter than written** (Q8, the PR 2
   review rulings, the #535 sweep). `consumed` is `null` when **any** discharge
   or intake asset at the site is stale or does not carry the period's key
   (`outlet_kl_*` or `kl_*` — a pre-v5 template does not). `intake − 0` applies
   only when the site has no discharge-roled asset at all. The intake column
   stays the sum of the fresh intake rows. Before the sweep, a site with one
   fresh intake of 1000, a second intake that could not report and a discharge
   of 300 read `consumed` 700; it now reads `null`.

10. **Decision 3's coverage is not "over the location's role-carrying assets"**
    (Q9, the PR 2 review). Coverage is `fresh/carrying` over the `intake`,
    `reuse` and `discharge` assets only — an `internal` asset feeds no column —
    and a role holder that does not carry the period's key is not counted in
    it.

11. **Decision 3's row-rule sentences are false** (the PR 2 review ruling). A
    site is a `water.balance` row only when it owns an `intake`, `reuse` or
    `discharge` asset; `internal` alone makes no row. That is not the
    `sustainability.by_location` row rule, which lists every location owning an
    asset in scope (ADR 0072, `E4.2` OQ7).

12. **ADR 0072's "verified at write time" now excludes stored values** (#533).
    `PUT /dashboards/:id/widgets` checks a submitted `pointKey` or
    `balanceRole` against live rows only when the dashboard's stored sources do
    not already carry it, inside the widget transaction; without that, one
    retired value blocked every later save, because the builder re-sends stored
    params and has no params editor. Template publish stays strict.

13. **What PR 3 measured** (#536, #537).
    - `BASELINE-WATER` now appears in ESKOM — 9 points, 0 pins — whichever order
      the seeds run. The plan's fact 11 said running the module before
      `seedAssetTemplateHealth` would prevent it; that was false.
    - The simulator's flows are **twelve** distinct keys, not the plan's
      thirteen.
    - The walk is bounded to `[0.5·base, 1.5·base]`; the first clamp,
      `[0, 1.5·base]`, averaged about 0.75·base.
    - Owner ruling **R2** (security review): the simulator emits water flows
      only for `WTR-` codes; any other water code gets none and one warning.
    - Owner ruling **R3** (#537): only `WTR-` water assets are wired to the
      simulator RTU. Before it, every non-manual ESKOM water asset was moved to
      `SIM-RTU-<site>-WATER` and `telemetrySource: simulator` on each boot, so
      an admin's MQTT water meter went dark. R3 does not restore an asset an
      earlier boot moved.
    - The plan's STP-to-discharge expectation was corrected: coverage is one
      string over the three columns, so the row reads `3/3`, never a per-column
      `0/0` or `2/2`.

14. **Security residual, open.** The simulator's `telemetrySource <> 'mqtt'`
    filter is the only barrier between it and an asset of any other domain; R2
    closed that for water alone.

15. **Residuals recorded at closure.** A `WTR-*` code that already exists —
    in another tenant, as an ESKOM admin's own asset, or as a non-demo `WTR-`
    water asset — stops or rewrites the seed (`F4.151`). CI has no general check
    that refuses an edit to a committed migration — only content pins in
    `tests/` that catch an edit to the strings they pin; the Claude hook and the
    git pre-commit hook both have a bypass, and `E4.1a`'s `0074` was applied
    locally from draft bytes (`F4.153`; `F4.94` owns only the journal stamps).
    `packages/shared/src/contracts/admin.ts` is at the line cap (`F4.150`).
    The live balance figures need a full `today` window and are checked the
    day after the stack boots; the backlog row carries the result.
