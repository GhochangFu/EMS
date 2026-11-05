# ADR 0081 — The mimic layout builder (`F3.32c`)

## Status

Accepted — drafted on 2026-09-28, before any implementation code. Five gate
questions were put to the owner one at a time and all five were ruled; each
ruling is recorded under *Gate questions*. The owner approved this written
record on 2026-09-28, and accepted the seven plan points recorded under
*Plan rulings* (plan `docs/plans/f3.32c-mimic-layout-builder.md` §10).

Implements the second stage of row `F3.32` (plant / network mimic builder), as
[ADR 0079](./0079-fixed-plant-mimic-widget.md) decision 9 planned it. The owner
ruled on 2026-09-28 to start it before the first stable version (due
2026-10-02, merge cutoff end of day 2026-09-30) **on one condition: if it is not
complete by the cutoff, the release ships the fixed mimic of ADR 0079 and this
work merges after the release.** Promotes nothing out of `AGENTS.md` §6.

## Context

**What exists.** ADR 0079 shipped the `mimic` widget type with one config arm,
`{ source: "preset", preset: "water_train" }` (`F3.32a`, PR #629), and its
reference look (`F3.32b`, PR #632). A preset is code: its topology is in
`packages/shared/src/mimic-presets.ts` and its coordinates, panels and symbols
are in `apps/web/src/lib/mimic.ts`. Each node resolves at read time to the
member of the dashboard's asset group that carries the node's
`bms.asset_roles` code (`GET /api/v1/dashboards/:id/mimic-nodes`).

**What is missing.** A customer cannot draw a plant. The Ion Exchange reference
(SOW pages 9–10, Nexus Sheet 03) shows plants with more units and other shapes
than `water_train`. Each new drawing is a code release today.

**What ADR 0079 decision 9 fixed in advance.** The builder keeps the widget
type, its place in the dashboard builder and the site view, the node renderer,
the membership-role binding and the read-time resolver. It adds a stored
layout, a page that draws one, and a second config arm
`{ source: "layout", layoutId }`.

## Decision

1. **Three tenant tables, one new migration.** Owner ruling Q2.
   - `bms.mimic_layouts` — `id`, `organization_id NOT NULL`, `name`, `slug`,
     `canvas_w`, `canvas_h` (grid units), `version` (optimistic concurrency),
     `created_by`, `created_at`, `updated_at`. Unique `(organization_id, slug)`.
   - `bms.mimic_layout_nodes` — `id`, `organization_id NOT NULL`, `layout_id`
     (`ON DELETE CASCADE`), `key` (unique per layout), `kind` (`unit`,
     `panel`, `label`), `symbol` (units only), `label`, `role_code` (units
     only and nullable: a unit with no role is a passive unit, such as
     Discharge, drawn with no status and no values; foreign key to
     `bms.asset_roles(code)`), `tone` (panels only),
     `x`, `y`, `w`, `h` (grid units, bounded by a CHECK), `z`.
   - `bms.mimic_layout_pipes` — `id`, `organization_id NOT NULL`, `layout_id`
     (`ON DELETE CASCADE`), `from_node_id`, `to_node_id`. A composite foreign
     key `(layout_id, from_node_id)` and `(layout_id, to_node_id)` to
     `mimic_layout_nodes (layout_id, id)` holds both ends in the same layout.
     A pipe cannot join a node to itself, and both ends must be units (not a
     panel, not a label), held by a three-column foreign key that includes
     the node's `kind`.
   - Each table has `tenant_isolation` and `FORCE ROW LEVEL SECURITY` in the
     same migration file. Each organization-bearing foreign key is checked
     with an `EXISTS` in `USING` **and** in `WITH CHECK`, as `F3.1a` found
     necessary: a referential check runs with row security off.
   - `kind`, `symbol` and `tone` are closed vocabularies, each declared twice
     (a `z.enum` in `packages/shared` and a `CHECK`), for the reason ADR 0047
     decision 2 gives: the behaviour of a symbol is a drawing, and no column
     holds one. A new symbol is a release.
2. **Save replaces the whole layout in one transaction.** `PUT` sends the
   layout with every node and pipe. The API checks `version`, deletes the
   layout's nodes (the pipes cascade), inserts the new set, and increments
   `version`. A stale `version` answers 409. Nothing outside the layout refers
   to a node id, so replacement loses nothing.
3. **An organization library, drawn by organization admins.** Owner ruling
   Q3. `admin` and `organization_admin` create, edit and delete layouts on a
   new page, `/admin/mimic-layouts`. Every dashboard author of the
   organization can select a layout. Routes:
   `GET|POST /api/v1/mimic-layouts`, `GET|PUT|DELETE /api/v1/mimic-layouts/:id`.
   Reads answer only the caller's organization (404 across organizations).
   `DELETE` answers 409 while a dashboard widget refers to the layout.
4. **The preset stays in code, and the editor copies it.** Owner ruling Q1.
   `{ source: "preset" }` is unchanged, and every stored widget keeps working
   with no data migration. The editor offers "Start from Water train", which
   copies the preset's nodes, panels, pipes and web coordinates into a new
   editable layout. This supersedes the last sentence of ADR 0079 decision 9
   ("the `water_train` preset then becomes a read-only built-in layout"): no
   row has a NULL organization, so no RLS policy gains a disjunct.
5. **A second config arm.** `mimicConfigSchema` becomes a discriminated union
   on `source`: `{ source: "preset", preset }` or
   `{ source: "layout", layoutId }`. `putWidgets` answers 400 when the layout
   is not in the dashboard's organization. The asset-group scope rule of ADR
   0079 decision 4 applies to both arms. **Dashboard templates accept only the
   preset arm in this stage**; a template that names a layout answers 400.
6. **Binding stays membership role only.** Owner ruling Q5. A unit names a
   role code; the dashboard's asset group supplies the member. One layout
   serves many plants. The resolver extends: for a layout widget it reads the
   layout's units and resolves each exactly as a preset node (top three points
   by `headline_rank`, open-alarm count, `topAlarm`, `+N`, readable-asset
   narrowing). The `mimic-nodes` response carries the layout's geometry, so a
   dashboard viewer needs no access to the layout routes.
7. **The editor.** Owner ruling Q4 — the core set with undo, redo and resize.
   - A snap-grid SVG canvas and a closed symbol palette: the `F3.32b` glyphs
     (`tank`, `clarifier`, `membrane`, `vessel`, `tower`, `aeration`,
     `dosing`, `pump`, `discharge`) plus `valve`, `filter` and `unit` (a
     plain box).
   - Place, move, resize and delete a unit, a panel or a label. Name it. Bind
     a unit to a role. Set a panel's tint (`info`, `neutral`, `accent`).
   - Draw a pipe from one unit to another; the renderer routes it
     orthogonally. The flow dash follows `F3.32b`'s freshness rule.
   - Undo and redo over an in-memory history (the unsaved edits only).
   - Keyboard: arrows move, Shift+arrows resize, Delete removes, Ctrl+Z and
     Ctrl+Y undo and redo.
   - Drag uses hand-built pointer events, as the dashboard builder does. No
     new dependency.
8. **The dashboard builder** offers the mimic's source: a preset, or a layout
   from the organization's library.
9. **Colours use role tokens only** (ADR 0078, `AGENTS.md` §5 FLOOR rule).
10. **Out of this ADR:** network (electrical) mimics, free shapes and free
    lines, per-unit colours, KPI overlays beyond the unit values, layouts in
    dashboard templates, sharing a layout across organizations, and the SMOC
    pages moved onto a mimic. `F3.32` stays open for them.

## Gate questions

1. **Q1 — the fixed preset.** Options: keep the preset in code and copy it
   into a new layout; or move it to a read-only built-in row. **Ruled: keep
   the preset and copy.**
2. **Q2 — storage.** Options: one `jsonb` document per layout; or node and
   pipe tables. **Ruled: node and pipe tables**, for integrity in the
   database (a role code and both pipe ends are foreign keys).
3. **Q3 — who draws.** Options: organization admins, organization library;
   or every dashboard author with a scope column. **Ruled: organization
   admins, organization library.**
4. **Q4 — the editor set.** Options: the core set; or the core set with undo,
   redo and resize. **Ruled: core set with undo, redo and resize.**
5. **Q5 — binding.** Options: membership role only; or a role or a fixed
   asset. **Ruled: membership role only.**

## Plan rulings

Accepted by the owner on 2026-09-28, all as the plan recommended:

1. A unit's role is optional (a passive unit). See decision 1.
2. A pipe joins two units only. See decision 1.
3. `POST /api/v1/mimic-layouts` carries `organizationId`; a global admin holds
   many organizations.
4. Any authenticated user of the organization reads the library; only
   decision 3's roles write.
5. One grid cell is 10 viewBox px; a canvas is 20–240 by 20–160 cells; a
   layout holds at most 120 nodes and 160 pipes.
6. "Start from Water train" rounds the preset's positions to the grid, so the
   copy is not pixel-identical to the preset.
7. Each widget in the `mimic-nodes` response gains `source` (`preset` or
   `layout`); the preset arm is otherwise unchanged.

## Dependencies

None.

## Consequences

- The release date does not move. If the builder is not merged by the end of
  2026-09-30, the release ships ADR 0079's fixed mimic, and this ADR's work
  merges after the release.
- Three new tenant tables raise the migration and security review load. Each
  organization-bearing foreign key needs its `EXISTS` pair; the reviews must
  prove the cross-tenant case on the running stack, as `F3.1a` did.
- Replace-on-save keeps the write path simple. A layout with many units writes
  every row on each save; the node count is bounded by the canvas, so the cost
  stays small.
- A new symbol is a release (a `z.enum` member, a CHECK, a glyph).
- Templates keep the preset arm only. A later stage can add layouts to
  templates once a template's layout reference has a delete rule.

## Amendment 1 (2026-11-05, `F4.307`) — a per-unit point list

**Status: proposed.** Drafted on 2026-11-05 and checked against `main` at
`4fcbb13`, before any implementation code. Four gate questions were put to the
owner one at a time on 2026-11-05; all four were ruled as recommended, and each
ruling is recorded under *Rulings*. The merge of
this amendment approves it. Decisions 1 to 10 stand except where an entry below
says it amends one. Promotes nothing out of `AGENTS.md` §6.

### Context

- A roled unit shows the first `MIMIC_HEADLINE_POINTS` (3) active points of its
  asset, ordered `headline_rank ASC NULLS LAST, point_key ASC`
  (`packages/shared/src/contracts/mimic.ts:22`; the per-asset `LIMIT` in
  `apps/api/src/dashboard-builder/mimic-nodes.service.ts`, statement 3).
  `headline_rank` is one fleet-wide value per key, set on `/admin/point-keys`.
- A layout cannot choose the points of one unit. A preset cannot either.
- The resolver reads points **per asset**, not per node. Two units (or two
  widgets) that show the same asset show the same three points today.
- The unit frame draws three value rows at fixed offsets
  (`ROW_Y = [152, 170, 188]`, `apps/web/src/components/widgets/mimic-scene.tsx:86`;
  `MIMIC_FRAME_H = 130`).
- Point keys are never deleted; they are deactivated
  (`apps/api/src/admin/point-keys/point-keys.controller.ts`).
- State points (`bms.point_key_states`, ADR 0088) are read on their own path,
  not through the headline points.

### Decision

1. A layout unit with a role may carry an ordered **point list**: up to
   `MIMIC_HEADLINE_POINTS` (3) point keys (Q4). An empty list keeps the
   headline rank (decision 6 unchanged). A unit with no role, a panel and a
   label hold no list.
2. **Storage (Q1).** A new tenant table `bms.mimic_layout_node_points`
   (`organization_id NOT NULL`, `node_id` → `bms.mimic_layout_nodes`
   `ON DELETE CASCADE`, `point_key` → `bms.point_keys(code)`, `ord`), unique
   `(node_id, ord)` and `(node_id, point_key)`, with `tenant_isolation`,
   `FORCE ROW LEVEL SECURITY` and the `EXISTS` pair in `USING` and
   `WITH CHECK`, in one new migration. Save still replaces the whole layout
   (decision 2): the rows cascade with their nodes and are inserted again.
3. **Presets (Q2).** A preset node has no list and keeps the headline rank.
   "Start from" a preset copies no list.
4. **A missing key (Q3).** A listed key that the shown asset lacks, or holds
   inactive, draws its row in its place: the key's catalog name and "—".
5. **The editor.** The inspector of a roled unit offers the list: pick keys
   from the active point-key catalog, order them, remove them. A deactivated
   key already in the list stays and is marked.
6. The resolver reads the listed keys for a unit that has a list, and the
   headline points for a unit that has none. Points become per node, not per
   asset, for a unit with a list.
7. Out of this amendment: KPI overlays beyond the unit values (`F3.82`), a
   point list on a dashboard template, and a per-site list.

### Gate questions

1. **Q1 — where the list lives.** (a) A child table
   `bms.mimic_layout_node_points` (`organization_id`, `node_id` with
   `ON DELETE CASCADE`, `point_key` → `bms.point_keys(code)`, `ord`), with
   `tenant_isolation`, `FORCE ROW LEVEL SECURITY` and the `EXISTS` pair, as
   decision 1; (b) a `text[]` column on `bms.mimic_layout_nodes` with a
   cardinality `CHECK` (no foreign key on the elements); (c) a `jsonb`
   column. *Recommended: (a)*, for the reason gate question 2 gave: integrity
   in the database (each key is a foreign key).
2. **Q2 — a preset unit.** (a) No list on a preset; "Start from" a preset
   copies it into a layout, where the list is set; (b) a per-node override in
   the preset widget's config. *Recommended: (a).*
3. **Q3 — a listed key the asset lacks (or has inactive).** (a) The row draws
   the key's catalog name and "—"; (b) the row is skipped and the next key
   moves up; (c) the empty slot falls back to the headline points.
   *Recommended: (a).*
4. **Q4 — the bound.** (a) 3, the same as `MIMIC_HEADLINE_POINTS`; the frame
   does not change; (b) a larger bound, and the frame grows with the list.
   *Recommended: (a).*

### Rulings

1. **Q1 (a) — a child table**, `bms.mimic_layout_node_points`. Ruled by the
   owner on 2026-11-05, as recommended.
2. **Q2 (a) — layouts only.** A preset keeps the headline rank; "Start from" a
   preset copies it into a layout, where the list is set. Ruled 2026-11-05, as
   recommended.
3. **Q3 (a) — name and "—".** A listed key the asset lacks, or has inactive,
   draws its row in place with the key's catalog name and "—". Ruled
   2026-11-05, as recommended.
4. **Q4 (a) — a bound of 3.** The list holds at most `MIMIC_HEADLINE_POINTS`
   (3) keys; the unit frame does not change. Ruled 2026-11-05, as recommended.
