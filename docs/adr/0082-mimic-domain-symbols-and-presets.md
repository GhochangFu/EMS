# ADR 0082 — Mimic symbols and presets for every asset domain (`F3.32d`)

## Status

Proposed — drafted on 2026-09-29, before any implementation code.

The owner ruled the scope on 2026-09-29, after a review of the `F3.32c`
editor: "Glyphs + Grouped Pallete + All Asset Grpup Starters (not only
Electrical/Hvac) + Presets". This record states what that ruling builds.

Amends [ADR 0081](./0081-mimic-layout-builder.md) decisions 1, 4 and 7, and
[ADR 0079](./0079-fixed-plant-mimic-widget.md) decision 2 (one preset). The
release condition of ADR 0081 applies again: **if this work is not merged by
the end of 2026-09-30, the release ships `F3.32c` as it is, and this work
merges after the release.** Promotes nothing out of `AGENTS.md` §6.

## Context

**What exists.** The editor at `/admin/mimic-layouts` (`F3.32c`, PR #635)
draws a layout from 12 closed symbols. Nine are water-plant drawings (`tank`,
`clarifier`, `membrane`, `vessel`, `tower`, `aeration`, `dosing`, `discharge`,
`filter`); three are general (`pump`, `valve`, `unit`). The only preset, and so
the only starter, is `water_train`.

**What the owner found.** The platform monitors seven asset domains
(`bms.asset_domains`: electrical, HVAC, IT, mechanical, water, environment,
facility). Binding already serves all of them: a unit names any
`bms.asset_roles` code, and the electrical and HVAC codes (`transformer`,
`ht-panel`, `lt-panel`, `mcc`, `chiller`, `ahu-fcu`, `cooling-tower`) exist.
Only the drawing is water-shaped. An electrical or HVAC plant can be drawn
today only with the plain `unit` box.

**Why a release, not data.** A symbol is an SVG drawing in code (ADR 0081
decision 1, ADR 0047 decision 2). A preset is code for the same reason (ADR
0079 decision 2). Role codes stay a dynamic vocabulary in `bms.asset_roles`.

## Decision

1. **Seventeen new unit symbols.** `mimicSymbolSchema` grows from 12 to 29
   members, appended in this order, and migration `0089` restates the list in
   `mimic_layout_nodes_symbol_check` (drop and add; `0088` is frozen):
   - Electrical: `transformer`, `breaker`, `switchboard`, `generator`,
     `meter`, `motor`.
   - IT and UPS: `ups`, `battery`, `rack`.
   - HVAC: `chiller`, `ahu`, `fan`.
   - Mechanical: `compressor`, `boiler`.
   - Environment: `sensor`.
   - Facility: `lamp`, `lift`.

   No symbol is named `panel`: that word is a node `kind`. Each symbol has a
   glyph in `mimic-glyphs.tsx` drawn with role tokens only (ADR 0078), and a
   label in the editor.
2. **A grouped palette.** The editor palette shows the symbols in eight
   groups, one per heading: Water, Electrical, IT and UPS, HVAC, Mechanical,
   Environment, Facility and General. The existing symbols go to Water
   (`tank`, `clarifier`, `membrane`, `vessel`, `aeration`, `dosing`,
   `discharge`, `filter`), HVAC (`tower`) and General (`pump`, `valve`,
   `unit`). The group of a symbol is a web-side table, not a stored value. The inspector's symbol select uses the same
   groups. Every symbol stays usable in every layout; a group is a way to
   find a symbol, not a limit.
3. **Six new presets, one per remaining asset domain.** `mimicPresetSchema`
   grows from `water_train` to seven members. Each preset is code in
   `packages/shared/src/mimic-presets.ts` (topology and role codes) and
   `apps/web/src/lib/mimic.ts` (coordinates, panels, glyphs), as
   `water_train` is:

   | Preset | Domain | Units (role code) | Pipes |
   |---|---|---|---|
   | `electrical_distribution` | Electrical | Incoming (`incoming-supply`), HT Panel (`ht-panel`), Transformer (`transformer`), LT Panel (`lt-panel`), MCC (`mcc`), DG Set (`dg-set`), UPS (`ups`) | Incoming → HT → Transformer → LT → MCC; DG Set → LT; LT → UPS |
   | `hvac_chiller_plant` | HVAC | Cooling Tower (`cooling-tower`), Chiller (`chiller`), Primary Pumps (`primary-pump`), Secondary Pumps (`secondary-pump`), AHU / FCU (`ahu-fcu`) | in that order |
   | `it_power_cooling` | IT | Utility Feed (`lt-panel`), UPS (`ups`), Battery (`battery`), PDU (`pdu`), IT Racks (`it-rack`), CRAC (`crac`) | Feed → UPS; Battery → UPS; UPS → PDU → Racks; CRAC → Racks |
   | `compressed_air` | Mechanical | Compressor (`air-compressor`), Dryer (`air-dryer`), Receiver (`air-receiver`), Header (`air-header`) | in that order |
   | `environment_monitoring` | Environment | Ambient (`ambient-station`), Indoor Air (`indoor-air`), Stack (`stack-monitor`), Effluent (`effluent-monitor`) | none |
   | `facility_services` | Facility | Main Meter (`meter`), Lighting (`lighting`), Lifts (`lifts`), Fire Pumps (`fire-pump`), Utilities (`utilities`) | Main Meter → each of the other four |

   A preset's `sink` becomes optional; only `water_train` has one. A preset
   with no pipes is valid. Every existing stored widget keeps
   `{ source: "preset", preset: "water_train" }` and draws as before. The
   dashboard builder, the site view and dashboard templates offer every preset
   (templates accept the preset arm, ADR 0081 decision 5), with no code of
   their own.
4. **Eighteen new role codes.** Migration `0089` inserts them into
   `bms.asset_roles` in the `0087` idiom (`SET ROLE bms_owner`, bare
   `ON CONFLICT DO NOTHING`, a `DO $$` self-check), each in its domain's
   sort band:
   - Electrical 190: `dg-set`.
   - HVAC 560: `secondary-pump`.
   - IT 610–650: `ups`, `battery`, `pdu`, `it-rack`, `crac`.
   - Mechanical 710–740: `air-compressor`, `air-dryer`, `air-receiver`,
     `air-header`.
   - Environment 810–840: `ambient-station`, `indoor-air`, `stack-monitor`,
     `effluent-monitor`.
   - Facility 910–930: `lighting`, `lifts`, `fire-pump`.

   The codes are then usable by every asset-group membership and every
   drawn unit, not only by the presets.
5. **A starter for every preset.** The layout library replaces the one
   "Start from Water train" link with a "Start from" select of all seven
   presets and a button. The copy works as ADR 0081 decision 4 states,
   generalised: the preset's units, panels, pipes and grid-rounded positions,
   and the sink as a passive unit when the preset has one.
6. **No seed change.** No demo organization gains members for the new roles.
   A preset unit whose role no member of the dashboard's group carries shows
   "Not assigned", as today. An administrator binds members on the asset-group
   page.
7. **Out of this ADR:** network (electrical) mimics — breaker state,
   energised paths, bus topology — stay out, as ADR 0081 decision 10 states.
   A breaker symbol here is a drawing bound to a role like any unit, with no
   switching state. Also out: connector styles per domain (a pipe stays a
   pipe with the `F3.32b` flow dash), a stored symbol group, new seed data,
   and the rename of "Pipe mode". `F3.32` stays open for them.

## Dependencies

None.

## Consequences

- A symbol and a preset are still releases. This ADR adds 17 symbols and 6
  presets in one release, so the next domain need is less likely to wait on
  code.
- The symbol CHECK changes a second time within two days. The migration
  drops and adds one constraint on a table with few rows; it rewrites no data.
- Six presets add web coordinates that no test can judge by eye. The browser
  check must open each preset once in a widget and once as a starter.
- The palette grows from 12 to 29 buttons. The groups keep it readable; the
  General group stays last.
- A new organization sees "Not assigned" on most preset units until its
  administrator binds members. That is the existing behaviour for
  `water_train`.
