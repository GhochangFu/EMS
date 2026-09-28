# ADR 0079 — A fixed plant mimic as a dashboard widget type (`F3.32` v1)

## Status

Proposed — drafted on 2026-09-28, before any implementation code. The gate
questions below go to the owner one at a time; each ruling is recorded under
*Gate questions* as it lands. Nothing here is accepted until the owner approves
this written record.

Implements a first, narrow cut of row `F3.32` (plant / network mimic builder).
The owner ruled the cut on 2026-09-28: **a fixed mimic widget, not a drawing
editor**, for the first stable version due 2026-10-02 (merge cutoff end of day
2026-09-30). Promotes nothing out of `AGENTS.md` §6.

## Context

**The ask.** The IONSiTE NEXUS feature sheet (row 10, 2026-08-22) asks for
process-line diagrams and plant mimics with live values, asset status, alarms
and KPI overlays. The owner wants plant mimics on the dashboard for the first
customer demo.

**What `F3.32` is sized at.** 6–10 person-weeks, P2, no ADR. Its own row names
the open scope question: config-driven composition of existing parts, or a
drawing surface. A drawing surface does not fit in two days. This ADR takes the
first option, and only one preset.

**What earlier ADRs already decided about the mimic.**

- [ADR 0076](./0076-control-room-for-each-organization.md) decision 8: the
  `F3.32` mimic arrives **as a widget type** in the ADR 0047 builder, bound to
  membership roles, so it appears in templates, dashboards and the site view
  with no change to the site view.
- [ADR 0049](./0049-section-dashboard-templates.md) decision 4: a template
  widget binds `(assetRoleCode, pointKey)`, never an asset id.
- [ADR 0047](./0047-configurable-dashboards.md) decision 2: `widget_type` is a
  closed vocabulary, declared twice — `widgetTypeSchema` in
  `packages/shared/src/contracts/dashboard-builder.ts` and
  `dashboard_widgets_widget_type_check` in the database. Migration `0055`
  widened the CHECK for `table`; that is the precedent for a new type.

**What the code has today (measured 2026-09-28 at `2263196a`).**

- `widgetTypeSchema` = `radial_gauge`, `tank_level`, `value_tile`, `chart`,
  `table`. `dashboard-builder.spec.ts:92` uses `mimic` as its example of an
  undeclared type that the contract must refuse; that example must change.
- `bms.dashboard_widget_points.role` is a closed renderer-slot vocabulary
  (`primary | series`, `dashboard_widget_points_role_check`). It is not the
  asset role.
- The membership role lives on `bms.asset_group_members.role`, an FK into
  `bms.asset_roles`. Seeded codes (`0051`, `0060`): `aeration`, `biological`,
  `discharge`, `disinfection`, `distribution`, `equalization`, `mcc`, `meter`,
  `neutralization`, `pump`, `settling`, `transformer`, `treatment`,
  `utilities`. There is no `intake`, `ro`, `softener` or `storage` role.
- The live-SVG machinery exists: `SchematicTelemetryProvider`,
  `LiveSvgComponent`, `ElectricalSldDiagram`, `CracSchematic`
  (`apps/web/src/components/live-svg/`). Each is a hand-drawn SVG with fixed
  bindings by asset code.
- A demo water plant is seeded: five `WTR-` assets at CSMOC Gauteng — WTP,
  RO, cooling tower, STP, ETP — with simulated flows
  (`packages/db/src/water-plant-demo-seed.ts`, ADR 0073). They carry a
  **water balance role** (`intake`, `internal`, `reuse`, `discharge`), which is
  a different vocabulary from the membership role.
- `bms.point_keys.headline_rank` (`F3.68`) ranks the main points of a class.

## Decision

*Proposed. Each item is final only after its gate question is ruled.*

1. **One new widget type, `mimic`.** `widgetTypeSchema` and
   `dashboard_widgets_widget_type_check` gain `mimic` together, in one change
   set (a new migration, the `0055` pattern).
2. **The config names a preset from a closed list.** The config is
   `{ source: "preset", preset }`, and `preset` is a `z.enum`. The `source`
   discriminator is there for decision 9: the full builder adds a second arm
   beside this one, and a stored v1 widget never needs migrating. v1 ships one preset: `water_train` — intake → WTP → RO →
   softener → storage, with the STP and ETP branch to discharge. Each preset
   node shows the node name, a status colour (running / alarm / stale, ADR
   0027 gate), and up to three live values. A new preset is a code release, as
   a new widget type is.
3. **A node finds its asset by membership role, with no binding screen**
   (Q1). Each preset node names one `bms.asset_roles` code. The node shows
   the member of the dashboard's asset group that carries that role, and the
   member's top three points by `bms.point_keys.headline_rank` (`F3.68`; an
   unranked key falls back to the first by `point_key`, as `F3.68` does). If
   no member carries the role, the node shows "Not assigned". If two members
   carry it, the node shows the first by asset code and a count badge ("+1").
   **The role resolves at read time, not at write time.** The mimic writes no
   `bms.dashboard_widget_points` rows; the widget fetches its nodes from a
   group-scoped read (the shape of `F3.68`'s
   `/api/v1/control-room/sites/:locationId/generated`) and subscribes to
   `/ws/telemetry` for those points. So a role an operator changes later shows
   on the next load, with no re-save. A section template copies the mimic
   widget unchanged at instantiation; nothing resolves there. This differs from
   ADR 0049 decision 4, whose bindings resolve at instantiation, because a
   mimic carries no binding.
4. **The widget is placed only on a dashboard scoped to one asset group, and
   in section templates** (Q2). The builder does not offer `mimic` on a
   location-, asset- or unscoped dashboard, and the API answers 400 on such a
   write. `POST /admin/dashboard-templates/:id/instantiate` accepts a null
   `assetGroupId`; for a template that holds a mimic it answers 400 unless
   `assetGroupId` is set. The Control Room site view (`F3.69`) renders a
   group-scoped dashboard already, so the mimic appears there with no change.
5. **Seven new role codes and a wired demo plant** (Q3). A new migration
   inserts `water_intake`, `wtp`, `ro`, `softener`, `water_storage`, `stp`
   and `etp` into `bms.asset_roles`. The `water_train` preset's cooling-tower
   node uses the existing `utilities` code, so no eighth code is added. The
   seed creates the asset group "Demo water plant" at CSMOC Gauteng with the
   five `WTR-` assets and their roles (WTP `wtp`, RO `ro`, cooling tower
   `utilities`, STP `stp`, ETP `etp`), and one dashboard scoped to that group
   that holds the mimic. The intake, softener and storage nodes show "Not
   assigned" on the demo. The seed is idempotent and does not overwrite a role
   an operator changed.
6. **The builder editor** offers `mimic` in the widget-type picker, then a
   preset picker. No drawing, no drag of nodes, no per-node styling.
7. **Colours use role tokens only** (ADR 0078, the `AGENTS.md` §5 FLOOR rule).
   New files add no raw colour class.
8. **Out of this ADR:** a drawing surface, user-defined presets, network
   mimics, KPI overlays beyond the node values, and the SMOC pages moved onto a
   mimic. `F3.32` stays open for them.
9. **This is the first stage of the full builder, not a throwaway.** The full
   `F3.32` builder extends the same area and needs its own ADR. What it keeps:
   the `mimic` widget type, its place in the dashboard builder, templates and
   the site view, the node renderer, the membership-role binding and the
   read-time node resolver. What it adds: a stored layout (nodes with
   positions, symbols and pipes) in a new table, a new admin page that draws
   one, and a second config arm `{ source: "layout", layoutId }`. The
   `water_train` preset then becomes a read-only built-in layout, and every
   dashboard that uses it keeps working.

## Gate questions

1. **Q1 — node binding.** Options: membership role with automatic headline
   points; an explicit asset pick per node (a new column on
   `dashboard_widget_points`); match by asset template class. **Ruled
   2026-09-28: membership role, automatic.** It follows ADR 0076 decision 8
   and ADR 0049 decision 4, and needs no binding screen.
2. **Q2 — placement.** Options: group-scoped dashboards and section templates
   only; also site-scoped dashboards, with a role resolved across every group
   of the site. **Ruled 2026-09-28: group scope and templates only.** A site
   scope would need a hidden tie-break rule when two groups give one role.
3. **Q3 — role codes and the demo.** Options: a migration plus a seeded demo
   group and dashboard; the migration only; reuse the seeded codes. **Ruled
   2026-09-28: the migration plus the demo group.** Reuse would make WTP, RO
   and softener all `treatment`, and the nodes could not tell them apart.
   *Drafting note:* the ruling listed seven codes and "the five `WTR-` assets
   and their roles"; the cooling tower has none of the seven, so decision 5
   gives it the existing `utilities` code. The owner confirms this at the
   approval of this record.

## Dependencies

None. The SVG is hand-written; no drawing library is added.

## Consequences

- The mimic is a fixed picture. A plant whose process differs from the preset
  shows empty nodes, until a second preset ships.
- Two declarations of the widget vocabulary change in one change set; the
  migration and the contract ship together or not at all.
- **Open point 1 — ruled 2026-09-28: show the node dimmed, with "Not
  assigned".** Options were: show dimmed; hide the node and its pipe; a
  per-widget checkbox. The full process line stays visible and the picture
  never changes shape, so the customer sees what is not yet connected.
- **Open point 2 — ruled 2026-09-28: the customer demo runs in its own
  organization, set up by hand.** The seeded demo plant sits under `ESKOM` at
  "CSMOC Gauteng"; it stays there for development and tests (decision 5). The
  mimic is code, not data, so any organization can use it. For the Ion
  Exchange demo, an administrator creates an Ion Exchange test organization on
  the demo host in the admin screens: a site, five water assets from the stock
  water templates with `WTR-<CLASS>-NN` codes (the only codes the simulator
  gives water flows, in any organization; it reads assets once at start, so it
  restarts after), an asset group with the roles, and a group dashboard with
  the mimic. A login scoped to that organization never sees `ESKOM` or `PHE`.
  The steps are proved on the local stack before the cutoff and written as a
  runbook. Options were: this; seed the new organization; both. A seed would
  have to re-state the `ESKOM`-bound water seed and its post-conditions.
  Section templates are per organization, so a template authored in `ESKOM`
  does not carry over; the widget is added in the builder.
- **Schedule risk:** the read-time node resolver is new API and web code; the
  existing dashboard telemetry hook reads only bound points.
- `F3.65b` / `F3.65c` edit the same web tree in the same days. The mimic
  change set rebases after each of them and re-runs CI before its merge.
