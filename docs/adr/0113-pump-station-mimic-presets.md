# ADR 0113 — Pump-station mimic presets and site template (`F4.319`)

## Status

**Accepted — 2026-11-06** (owner, in chat: "Accept, merge on green"; proposed the same day). Raised by the owner on 2026-11-06: the default
electrical and environment mimics do not suit the PHE (PHEWB) sites, and the
owner wants an overview, an electrical and an environment view that follow the
assets these sites have, made as templates. The owner gave eight rulings in chat
on 2026-11-06, one at a time, before this record was written (listed under
*Rulings*). Lines marked
*(drafter)* are drafter calls that the `F4.319` plan may refine; the others are
rulings.

Promotes nothing out of AGENTS.md §6 and adds no dependency (§9.4).

Amends the `F3.40` / `F3.41` ruling of 2026-09-02 that both PHE pump shapes fill
one `pump` role: the ruling comment at `packages/db/src/asset-groups-seed.ts:91-99`
and the `PHE-PUMP-` branch at `:204-210`, the "ONE `pump` CODE, NOT TWO" header of
`packages/db/drizzle/0060_asset_role_estate_shapes.sql:26-33`, and the `F3.40`
closure text "One `pump` code and not also `dosing-pump`". Builds on [ADR 0079](./0079-fixed-plant-mimic-widget.md) decision 2 (a preset
is code, a new preset is a release) and [ADR 0081](./0081-mimic-layout-builder.md)
decision 5 (dashboard templates carry the preset arm only). Code citations are to
`main` at `26abdd1e`.

## Context

**What a PHE site has.** Read from the AWS demo API on 2026-11-06, and the same
in `packages/db/src/phe-catalog.json`:

- Six locations of type `pump_station`: Banchukamari, BhutnirGhat, Bilsi,
  Lotapata, Mora Nodir Kuthi, Salkumarhat.
- Each station has two RTUs (train I and train II). Each RTU has four assets:

| Asset | Group / role today | Points |
|---|---|---|
| `PHE-MFM-*` energy meter | `electrical` / `meter` | `kw`, `kwh_total`, `pf`, `kva`, `kvar`, `frequency_hz`, `voltage_l1_v`, `voltage_vry`/`vyb`/`vbr`, `voltage_vrn`/`vyn`/`vbn`, `current_ir`/`iy`/`ib` |
| `PHE-PUMP-M-*` main pump | `electrical` / `pump` | `breaker_main` (RTU input `di1`, "MAIN PUMP ONOFF") |
| `PHE-PUMP-C-*` chlorine pump | `electrical` / `pump` | `chlorine_pump_on` (`di2`) |
| `PHE-AIRSP1051M-*` RTU health | `environment` / none | `battery_charge_pct`, `network_strength`, `controller_power_status` |

- No flow, level, pressure, temperature or water-quality point exists.
- Rows arrived in the last 24 h from Bhutnirghat I, Bilsi I, Lotapata I and II,
  and Mora Nodir Kuthi I.

**What a PHE site shows today.** Each site dashboard
(`site-layout-phe-<slug>`) is a copy of the stock `smoc-standard` site template
(`packages/db/src/site-layout-seed.ts`). Its Overview draws a compact
`lv_single_line`, its SLD tab `lv_single_line` on the `electrical` group, and its
Env tab `environment_monitoring` on the `environment` group. The roles of those
presets (`incoming-supply`, `transformer`, `main-breaker`, `ups`, `pdu`, `crac`,
`ambient-station`, `indoor-air` …; the preset bodies from
`packages/shared/src/mimic-presets.ts:165` and `:199`) match no PHE asset, so every node is empty. PHEWB has no row in
`bms.mimic_layouts`.

**How a mimic binds.** A node binds by `role_code` inside the asset group of its
tab or dashboard. It takes the first member by asset code, or every member up to
the cap when `fanOut` is set (`apps/api/src/dashboard-builder/mimic-nodes.service.ts`).
A preset node lists no points: `mimic-nodes.pure.ts:182` gives it
`pointKeys: []`, so it shows the top three by `headline_rank`. A layout node may
list up to three (`F4.307`, ADR 0081 Amendment 1).

**Three gaps follow.**

1. One `pump` role holds the main pump and the chlorine pump, so a node cannot
   show one of them only.
2. The RTU-health assets have no role and are in another group than the pumps,
   so one overview cannot bind both.
3. No preset fits a pump station, and a preset cannot name its points.

## Rulings (owner, 2026-11-06)

- **Q1 — the template mechanism.** New global code presets, not per-organization
  layout rows and not `F3.81`. Three presets: overview, electrical and
  environment.
- **Q2 — two trains.** One fan-out node per equipment type. Each tile names its
  RTU (ADR 0111), for example "Lotapata II · Chlorine pump".
- **Q3 — the chlorine pump role.** A new role `dosing-pump` for the chlorine
  pumps. The main pumps keep `pump`. This reverses the 2026-09-02 ruling.
- **Q4 — the overview group.** A new seeded group `pump-station` per PHE site
  with all eight assets. The RTU-health assets take a new role `rtu-controller`.
- **Q5 — the water path.** "Tube well / raw water" → main pumps → "Overhead
  reservoir / distribution". Chlorine dosing injects into the delivery line.
- **Q6 — the meaning of `breaker_main` = 1.** Not known. Keep the current state
  labels. Check with the PHE field team (Bhutnirghat I read `breaker_main` = 1
  with `kw` = 0 on 2026-11-06).
- **Q7 — the environment view.** RTU health only: mains → RTU controllers →
  battery and GSM network. No node for a sensor that does not exist.
- **Q8 — how the presets reach the sites.** A new stock site template
  `pump-station-standard`. `smoc-standard` and the ESKOM sites do not change.

## Decision

1. **Three presets join `mimicPresetSchema`**
   (`packages/shared/src/contracts/mimic-config.ts:25`), with their topology in
   `MIMIC_PRESETS` and their coordinates, panels and symbols in
   `apps/web/src/lib/mimic.ts`. Every equipment node fans out.

   `pump_station_overview` — binds the `pump-station` group:

   | Node | Role | Symbol *(drafter)* | Points |
   |---|---|---|---|
   | `source` "Tube well / raw water" | none | `tank` | — |
   | `main_pump` "Main pumps" | `pump` | `pump` | `breaker_main` |
   | `delivery` "Overhead reservoir / distribution" | none | `tank` | — |
   | `dosing` "Chlorine dosing" | `dosing-pump` | `dosing` | `chlorine_pump_on` |
   | `meter` "Energy meters" | `meter` | `meter` | `kw`, `kwh_total`, `pf` |
   | `rtu` "RTU health" | `rtu-controller` | `sensor` | `battery_charge_pct`, `network_strength`, `controller_power_status` |

   Pipes: `source` → `main_pump` → `delivery`, and `dosing` → `delivery`.
   *(drafter)* `meter` and `rtu` sit in a panel beside the train, without pipes,
   because a pipe joins two units of the water path.

   `pump_station_electrical` — binds the `electrical` group:

   | Node | Role | Points |
   |---|---|---|
   | `incoming` "Grid supply 415 V" | none | — |
   | `meter` "Energy meters" | `meter` | `kw`, `voltage_vry`, `current_ir` |
   | `lt_bus` "LT bus" | none | — |
   | `main_pump` "Main pump starters" | `pump` | `breaker_main` |
   | `dosing` "Chlorine pump feeders" | `dosing-pump` | `chlorine_pump_on` |

   Pipes: `incoming` → `meter` → `lt_bus`, then `lt_bus` → `main_pump` and
   `lt_bus` → `dosing`. `sources: ["incoming"]`. *(drafter)* No RTU node here:
   the RTU-health assets are not in the `electrical` group, and Q4 keeps them
   out of it.

   `pump_station_environment` — binds the `environment` group:

   | Node | Role | Points |
   |---|---|---|
   | `mains` "Mains supply" | none | — |
   | `rtu` "RTU controllers" | `rtu-controller` | `controller_power_status` |
   | `battery` "Battery" | `rtu-controller` | `battery_charge_pct` |
   | `network` "GSM network" | `rtu-controller` | `network_strength` |

   Pipes: `mains` → `rtu` → `battery`, and `rtu` → `network`. Three nodes bind
   the same assets on purpose, so each point has its own node.

2. **A preset node may list its points.** `MimicPresetNode`
   (`mimic-presets.ts:26`) gains an optional `pointKeys` (at most three, each a
   `bms.point_keys` code), and the preset branch of `mimic-nodes.pure.ts:182`
   passes it on instead of `[]`. The F4.307 rule is unchanged: an empty or
   absent list means the headline rank, and a listed key the asset lacks is
   left out. The existing eight presets list nothing and do not change. The
   widget config and the API response shapes do not change, apart from the
   three new members of the `mimicPresetSchema` enum, which reach the OpenAPI
   document through the same Zod schema.

3. **Two roles join `bms.asset_roles`** in one migration (*(drafter)* the next
   free number at build time: `0127` on `26abdd1e`, unless `F4.317` takes it
   first): `dosing-pump` "Dosing pumps" and `rtu-controller` "RTU
   controllers", appended after `meter` (170) and `pump` (180) below the Water
   band that starts at 210 (*(drafter)* sort orders 190 and 200). Bare
   `ON CONFLICT DO NOTHING`, the `0060` way, so a re-run is a no-op, with a
   `DO` block post-check that both codes exist. The role vocabulary is a lookup
   table read by the admin role picker (`/admin/vocabularies/asset-roles`), so
   no code enum changes.

4. **Existing PHE memberships move to the new role.** The same migration sets
   `role = 'dosing-pump'` on every `bms.asset_group_members` row whose asset code
   starts `PHE-PUMP-C-` **and whose role is still `pump`**. A role an admin
   changed is left alone. A migration does this because the seed writes a role
   only while it is NULL (`COALESCE`, `asset-groups-seed.ts:397-406`).
   `demoRoleForAsset` (`:144`) returns `dosing-pump` for `PHE-PUMP-C-*` and
   `rtu-controller` for `PHE-AIRSP1051M-*`, so a fresh database gets the same
   result. Its one-branch comment and the `asset-groups-seed.spec.ts`
   assertions are rewritten to this record. The memberships of `PHE-AIRSP1051M-*` in the
   `environment` group take `rtu-controller` where their role is NULL.

5. **The stock electrical section template follows the split.** Its
   `chlorine_pump_on` binding (`stock-catalog-electrical.ts:432-438`) moves from
   `assetRoleCode: "pump"` to `"dosing-pump"` in the same change. That entry's
   `stockVersion` goes from 1 to 2. An organization that already holds a copy
   keeps it as it is; an admin takes version 2 through the existing
   `POST /api/v1/dashboard-templates/stock/:code/import`.
   Each binding then resolves on all of what it matches.

6. **A new seeded group `pump-station`** per PHEWB pump-station location, named
   "Pump station", domain NULL, with all eight assets and their roles.
   `demoGroupCodesForAsset` (`asset-groups-seed.ts:267`) adds `pump-station`
   for every `PHE-` asset, and `demoGroupName` (`:291`) and
   `demoGroupDescription` (`:347`) name it. The insert-if-absent rules of the
   `electrical` group apply. An asset may be in more than one group, so the
   `electrical` and `environment` groups do not change.

7. **A new stock site template `pump-station-standard`** in
   `packages/shared/src/site-templates/`, registered in
   `apps/api/src/admin/dashboard-templates/stock-catalog.ts` beside
   `smoc-standard`. Three tabs *(drafter: tile set beyond the mimics)*:
   - **Overview** — compact `pump_station_overview` on the `pump-station`
     group, plus the KPI, alarm and trend tiles `smoc-standard` puts on its
     Overview.
   - **Electrical** — `pump_station_electrical` on the `electrical` group, plus
     the breaker and asset tables.
   - **Environment** — `pump_station_environment` on the `environment` group,
     plus the asset table.

   Admins apply it to any pump-station site through the existing
   `POST /api/v1/dashboard-templates/:id/apply-to-sites`. It is a preset-arm
   template, so ADR 0081 decision 5 holds.

8. **The seed moves the untouched PHE copies.** For each PHEWB location whose
   `bms.site_control_room_views` row points at a seed-owned
   `site-layout-phe-<slug>` copy that no admin changed, the seed re-plans the
   copy from `pump-station-standard`. A copy an admin edited, a removed copy and
   any other view row are left alone (the "never overwrites" rule of
   `site-layout-seed.ts`). *(drafter)* The plan decides whether "untouched" is
   read from the existing stock-version stamp or from a content hash.

9. **No new node kind, symbol, colour or table.** The presets use core symbols
   only (`tank`, `pump`, `dosing`, `meter`, `sensor`;
   `packages/shared/src/contracts/mimic-layouts.ts:63-94`). State labels stay as they are (Q6).

## Dependencies

None.

## Consequences

- PHE sites draw full mimics from live data: on 2026-11-06 Bhutnirghat I,
  Bilsi I, Lotapata I and II and Mora Nodir Kuthi I. Banchukamari and
  Salkumarhat draw the nodes with no reading, which is their real state.
- Any organization with pump stations can use the presets in the widget
  inspector and the new site template. An admin who wants a different drawing
  copies a preset into an editable layout ("Start from"), as today.
- The 2026-09-02 one-`pump` ruling is reversed. The `F3.41` "half of each
  binding resolves" consequence goes away.
- Deferred: the meaning of `breaker_main` = 1 (Q6, field team); a bad scale on
  Lotapata II (`battery_charge_pct` = −1239.13 on 2026-11-06), which is a data
  item, not part of this record; layouts in templates (`F3.81`) and layouts
  shared across organizations (`F3.83`) stay open.
- Build *(drafter)*: PR 1 migration and seed (roles, memberships, the
  `pump-station` group, `demoRoleForAsset`, the section-template binding);
  PR 2 the shared presets, the `pointKeys` contract and the web coordinates;
  PR 3 the `pump-station-standard` template and the seed move, then the §4.6
  checks on the AWS live sites.
