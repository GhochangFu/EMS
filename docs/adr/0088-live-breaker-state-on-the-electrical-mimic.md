# ADR 0088 — Live breaker state on the electrical mimic (`F3.74`)

## Status

Accepted — drafted on 2026-10-01, before any implementation code, as
[ADR 0087](./0087-one-control-room-and-smoc-standard-site-template.md)
decision 8 requires. Twelve scope questions were put to the owner one at a
time on 2026-10-01; all were ruled, and each ruling is recorded under *Gate
questions*. The owner approved this written record on 2026-10-01.

Implements row `F3.74` (phase 2 of ADR 0087). Amends
[ADR 0079](./0079-fixed-plant-mimic-widget.md) decision 4,
[ADR 0081](./0081-mimic-layout-builder.md) gate question 5 and decision 10,
[ADR 0082](./0082-mimic-domain-symbols-and-presets.md) decision 7 and ADR 0087
decision 5 (see *Amended records*). Promotes nothing out of `AGENTS.md` §6.

**Sequencing.** The research for this record was read-only at `origin/main`
`6d4d0505`. No build starts until the `F3.73` critique-fix pull request
merges: it edits the mimic sizing, the "Not assigned" rendering, the copy-time
planner and the seed, which this row also touches.

## Context

**What the hand-written SMOC SLD shows today** (`RSMOC-WC` only,
`apps/web/src/components/control-room/smoc/sld.tsx`, `MiniSld` in
`smoc/overview.tsx:590-656`, the table in
`components/control-room/breaker-table.tsx`):

- Twelve breakers, `CR-Q1`…`CR-Q12`, on a fixed drawing: utility, transformer,
  main bus, Q1 main MCCB, UPS inputs (Q2, Q3), UPS outputs (Q4, Q5), a load bus
  (Q6–Q9, rack PDUs) and mains feeders (Q10–Q12, HVAC and lighting).
- Five visual states (`BreakerVisualStatus`): `normal` (CLOSED), `open`,
  `offline`, `warning`, `critical`. There is no TRIPPED state. The browser
  derives the state (`deriveBreakerRuleState`, `sld.tsx:94-125`) in this
  order: stale → offline; `breaker_main = 0` → open; an enabled threshold rule
  that matches the live value → warning or critical; else closed.
- Energisation is not computed. The buses are static fills; each branch line
  follows its own breaker. The `MiniSld` main bus takes the worst state of the
  breakers below it.
- A breaker table: Breaker, Position, Rating, Status, I (A), kW, kWh, Trip
  Cause. Position, Rating and Trip Cause are static strings in code
  (`CR_BREAKERS`, `components/live-svg/control-room-bindings.ts:83-96`).

**What the data holds.**

- `telemetry.point_values.value` is `double precision NOT NULL`. No point has a
  data type or a state map; the only sign of a discrete point is an empty unit.
- `breaker_main` (1 closed, 0 open) arrives live from 5 real PHEWB RTUs (on
  `pump` assets) and from 28 simulated ESKOM assets. `breaker_trip` is declared
  in the stock feeder template, but no device and not the simulator sends it.
- `breaker_main` has headline rank 10, so it is outside a mimic node's top
  three points (`MIMIC_HEADLINE_POINTS = 3`).
- Migration `0033` raises a critical "Main breaker reported OPEN" alarm on
  every ESKOM electrical asset at `breaker_main < 0.5`. The simulator holds
  `CR-Q11` and `CR-HVAC-2` open on purpose.
- Assets have no topology (no parent, feeds or bus relation). The only
  topology is the directed pipes of a preset or a drawn layout.

**What the mimic can do today.**

- A node binds one membership role and shows **one** member
  (`DISTINCT ON (group, role)` by asset code,
  `apps/api/src/dashboard-builder/mimic-nodes.service.ts`). The seed gives all
  twelve `CR-Q*` breakers role `mcc`, so they collapse into one node with
  "+11".
- The `breaker` glyph (ADR 0082) is a static drawing with no switching state.
- The widget already overlays socket readings on the node values, and the tank
  `level` point (`mimicLevelPoint`) is a precedent for a symbol-specific point.

**Live-data audit, 2026-10-01** (read-only, 16 mimic widgets, 94 preset
nodes, no drawn layouts): 7 nodes resolve a member (stale at the time because
the simulator container had stopped); 87 show "Not assigned". The causes are
seed and binding faults (roles on another group, preset roles no asset
carries, seeded roles no preset draws). They belong to the `F3.73` critique
fix and are not decided here.

## Gate questions

Ruled by the owner on 2026-10-01, one at a time:

1. **Q1 Scope against `F3.75` parity.** Options: the mimic only; full SLD
   parity; state only. **Ruled: full SLD parity** — breaker state, energised
   paths, alarm colour, the breaker table and the Overview MiniSld are all
   `F3.74`. `F3.75` then only moves `RSMOC-WC`.
2. **Q2 Many breakers on one role.** Options: a fan-out node; one role per
   position; a fixed asset on a node. **Ruled: a fan-out node** (decision 4).
3. **Q3 The source of the state.** Options: two keys mapped in code; a state
   map in the point catalog; `breaker_main` only. **Ruled: a state map in the
   catalog** (decision 2).
4. **Q4 An open breaker with an alarm.** Options: state wins and the alarm
   badge stays; alarm wins; a middle rule. **Ruled: state wins, the badge
   stays** (decision 5).
5. **Q5 Energised paths.** Options: breakers switch and other nodes pass; any
   unknown node stops; no walk. **Ruled: breakers switch, other nodes pass**
   (decision 6).
6. **Q6 The SLD drawing.** Options: a new preset; extend
   `electrical_distribution`; drawn layouts in templates. **Ruled: a new
   preset** (decision 8).
7. **Q7 Breaker role codes.** Options: codes per bus position; one `breaker`
   role with an order rule; reuse existing codes. **Ruled: codes per bus
   position** (decision 9).
8. **Q8 Warning and critical colour.** Options: active alarms; rule match in
   the browser; both. **Ruled: active alarms** (decision 7).
9. **Q9 The breaker table.** Options: a new widget with live columns; a new
   widget plus asset fields; extend the `table` widget. **Ruled: a new widget
   plus asset fields** (decision 10).
10. **Q10 The Overview MiniSld.** Options: a mimic names a tab; a new
    `mini_sld` widget; counts on the module card. **Ruled: a mimic names a
    tab** (decision 11).
11. **Q11 Where it is proved before `F3.75`.** Options: a seed demo dashboard;
    test fixtures only; breakers added at CSMOC. **Ruled: a seed demo
    dashboard** at `RSMOC-WC` (decision 13).
12. **Q12 The SMOC standard template.** Options: no change; a new template
    version now; pick per site. **Ruled: a new template version now**
    (decision 12).

## Decision

### State

1. **Display only.** The mimic shows breaker state. It never operates a
   breaker. Two-way commanding stays out (`AGENTS.md` §6; the command path is
   row `F3.12`).
2. **A state map in the point catalog.** A new fleet-wide table,
   `bms.point_key_states` (`point_key_code` → `bms.point_keys(code)`, `value`
   double, `label`, `tone`), maps a numeric value of a point key to a label and
   a tone. Both keys are catalog rows today. It is master data like
   `bms.point_keys` (migration `0059`): one list for every
   organization. `tone` is a closed vocabulary (a `z.enum` and a `CHECK`), for
   the reason ADR 0047 decision 2 gives: each tone is a drawing. `F3.74` seeds
   rows for two keys only — `breaker_main` (0 OPEN, 1 CLOSED) and
   `breaker_trip` (1 TRIPPED). Other status keys (`ups_status`,
   `pdu_a_status` and more) can gain rows later as data.
3. **A breaker reads its state points directly**, as the tank reads its
   `level` point: not through the top-three headline points. The breaker
   state is: `breaker_trip` maps to TRIPPED → TRIPPED; else the mapped value
   of `breaker_main`; a value with no row → unknown. The socket overlay
   updates the state as it updates the node values.

### Drawing

4. **A fan-out node** (amends ADR 0081 gate question 5). A preset unit can
   draw **every** member of its role, one breaker for each member in asset-code
   order, on a shared bus. Binding stays by membership role only, so a
   template still names no asset id (ADR 0087 decision 5). The resolver
   returns all members for a fan-out node, each with its state points, alarm
   count and freshness.
5. **Precedence of a breaker's look**, as the SMOC SLD does: offline (stale,
   ADR 0027) → TRIPPED → OPEN → alarm colour → CLOSED. An open breaker draws as
   OPEN. Its alarm count badge stays on the node, and the alarm stays in the
   alarm rail. Offline looks different from OPEN (ADR 0027 decision 5).
6. **Energised paths by a walk over the directed pipes.**
   - Energy starts at each source and follows the pipes.
   - Only a breaker switches. A CLOSED, fresh breaker passes energy. An OPEN or
     TRIPPED breaker stops it. A stale, unassigned or unknown breaker makes
     the path after it **unknown**.
   - Every other node, assigned or not, passes energy through.
   - Two sources join as OR: a segment is energised when any path to it is
     energised; else unknown when any path is unknown; else de-energised.
   - Three looks: energised, de-energised, unknown. Unknown never looks
     energised (ADR 0027).
   - Recommended, for the plan to confirm: one pure function in
     `packages/shared`, run in the web over the `mimic-nodes` response and the
     socket overlay, so the look changes on each reading with no new route.
7. **Warning and critical colour from active alarms.** A CLOSED breaker takes
   the colour of its worst active alarm, which the resolver already returns.
   There is no rule matching in the browser. A rule with a delay colours the
   breaker only when its alarm opens; that is a recorded difference from the
   SMOC SLD.
8. **A new preset**, proposed name `lv_single_line`, with the SMOC topology:
   incoming supply → transformer → main bus → main breaker → UPS input
   breakers → UPS → UPS output breakers → load bus → load feeders, and the
   mains feeders. `mimicPresetSchema` grows by one member. The breaker nodes
   are fan-out nodes (decision 4). The `breaker` glyph gains its states. This
   brings one network mimic into scope (amends ADR 0081 decision 10 and ADR
   0082 decision 7). `electrical_distribution` does not change.
9. **Five new role codes** in the electrical sort band, inserted in the
   migration `0087` idiom: `main-breaker`, `ups-input-breaker`, `ups-output-breaker`,
   `load-feeder-breaker`, `mains-feeder-breaker`. The seed moves `CR-Q1`
   (main), `CR-Q2`–`Q3` (UPS input), `CR-Q4`–`Q5` (UPS output), `CR-Q6`–`Q9`
   (load feeders) and `CR-Q10`–`Q12` (mains feeders) off `mcc`.

### Widgets

10. **A `breaker_table` widget type.** `widgetType` stays closed (ADR 0047
    decision 2), so a migration widens `dashboard_widgets_widget_type_check`.
    The table lists every member of the five breaker roles in the bound group:
    Breaker, Position (the role's label), Rating, Status (decision 5), I (A),
    kW, kWh, Trip Cause. Two nullable asset fields, `rating` and `trip_cause`,
    hold the static columns; the seed fills them for `CR-Q1`…`Q12` from
    `CR_BREAKERS`.
11. **A mimic on the Overview tab names a tab** (amends ADR 0079 decision 4
    and ADR 0087 decision 5). A mimic on a tab with no group may name one tab
    of the same dashboard, and resolves through that tab's group. The API
    refuses a named tab that is not in the same dashboard, or that has no
    group. It draws the SLD preset at a compact size; the main bus takes the
    worst state of the breakers below it, as `MiniSld` does.

### Template, seed and simulator

12. **A new published version of "SMOC standard".** Its electrical tab draws
    `lv_single_line` and adds a `breaker_table` (gate question 12); its
    Overview adds a mimic that names the electrical tab, which follows from
    gate questions 1 and 10 (the MiniSld is part of parity). Only new copies
    get it. Existing copies are not
    overwritten (ADR 0087 gate question 4). A site with no breaker-role
    members draws "Not assigned" breakers until an admin binds them.
13. **A seed demo dashboard at `RSMOC-WC`.** A library dashboard scoped to
    `RSMOC-WC`'s electrical group, with the SLD mimic and the breaker table,
    beside the hand-written SLD. The site view stays `builtin` until `F3.75`.
    The seed puts the members the preset names (UPS units and loads) into that
    group.
14. **The simulator sends `breaker_trip`** for at least one breaker, so the
    TRIPPED state can be seen on the demo stack.

### Amended records

15. This record amends:
    - **ADR 0081 gate question 5** (membership role only): a node can draw
      every member of its role (decision 4). Binding is still by role.
    - **ADR 0081 decision 10** and **ADR 0082 decision 7** (no network mimic,
      no breaker state): the `lv_single_line` preset, breaker state and
      energised paths are in scope (decisions 3–8). Free shapes, per-domain
      connector styles and the other items of those lists stay out.
    - **ADR 0079 decision 4** and **ADR 0087 decision 5** (a mimic needs a
      group): a mimic on a tab with no group may name a tab of the same
      dashboard (decision 11).

### Design questions for the step-3 plan

16. Not decided here; the plan puts each to the owner:
    - The exact shape and RLS posture of `bms.point_key_states`, and the
      `tone` vocabulary.
    - The column types of `rating` and `trip_cause`, and whether an admin
      edits them in the asset form in this row.
    - Whether drawn layouts also get fan-out nodes (a column on
      `bms.mimic_layout_nodes` and an editor toggle), or presets only.
    - What a source is (a node with no incoming pipe, or named source roles),
      and how a pipe out of a fan-out node takes its energy.
    - Whether the energised look replaces the `F3.32b` flow dash on the
      electrical presets.
    - A cap on the members of one fan-out node.
    - The pull-request split.

## Consequences

- **The row is larger than its estimate.** Full parity adds a preset, a
  widget type, a catalog table, two asset fields, five role codes, a template
  version, seed and simulator changes. The 3–5 day estimate in
  `docs/BACKLOG.md` does not hold; the plan gives a new one and a split.
- **Schema changes** (the state table, the asset fields, the widened CHECK,
  the role rows) go through `migration-reviewer` and `security-reviewer`.
- **Recorded parity differences** from the SMOC SLD: Position is the role's
  label, not the free text of `CR_BREAKERS`; warning and critical come from
  alarms, not from a browser rule match; a TRIPPED state is new.
- **`F3.75`** then only switches `RSMOC-WC`'s view to a copy and removes the
  hand-written pages.
- **The audit's binding faults stay open** until the `F3.73` critique fix or a
  later row corrects the seed and the presets. Until then most preset nodes on
  CSMOC and PHEWB show "Not assigned", with or without this row.

## Amendment 1 (2026-10-01, `F3.74`) — plan rulings

**Status: accepted.** The owner approved the plan on 2026-10-01
(`docs/plans/f3.74-live-breaker-state.md`, revision 2). The owner ruled each
open question of decision 16 on 2026-10-01, one at a time, after a research
pass at `main` `b21eadad`, and then approved the plan decisions listed below.
Decisions 1 to 15 stand except where an entry below says it widens one.

### Rulings

Every ruling is dated 2026-10-01. Two changed the plan, and both are marked: OQ3 with OQ3b (one change), and
OQ5.

1. **OQ1 (a) — the state table.** `bms.point_key_states` is global master
   data with no row-level security; `tone` is one of `closed`, `open`,
   `tripped`; the rows are seed-owned; `INSERT`, `UPDATE` and `DELETE` are
   revoked from `bms_tenant`. As recommended.
2. **OQ2 (a) — the asset fields.** `rating varchar(32)` and `trip_cause
   varchar(128)`, both nullable, on `bms.assets`. An admin edits them in the
   asset form in this row. As recommended.
3. **OQ3 — changed: drawn layouts get fan-out too.** The recommendation was
   presets only. A layout unit can fan out like a preset node.
4. **OQ3b "Full" — changed: the layout flags.** `bms.mimic_layout_nodes` gains
   `fan_out` and `is_source` (booleans, units only; a `CHECK` holds panels and
   labels at false), with two inspector toggles. A unit whose symbol is
   `breaker` switches (no column). The energised walk runs on layouts as on
   presets, with the `is_source` units as sources. "Start from" a preset copies
   the flags, so "Start from `lv_single_line`" yields a working SLD layout. The
   columns go into migration `0097`; `security-reviewer` reads PR1. This
   **widens decision 4** from "a preset unit" to "a preset node or a layout
   unit". It also means **ADR 0081 decision 6's one resolution now fans out for
   both arms**.
5. **OQ4 (a) — sources and fan-out energy.** Sources are declared, not
   inferred. A fan-out node passes energy when any member is CLOSED (OR). As
   recommended.
6. **OQ5 — changed: the freshness dash stays.** The recommendation was to
   replace the `F3.32b` flow dash on the electrical presets. The dash stays on
   every preset and layout, and the energy colour is added: energised in the
   accent colour, de-energised in grey, unknown in a dashed hint colour.
   Unknown never looks energised. **Accepted by the owner:** an OPEN breaker
   whose asset is fresh may still animate its downstream pipe, in grey.
7. **OQ6 (a) — member cap.** A fan-out node draws up to 16 members, then "+N
   more". As recommended.
8. **OQ7 (a) — the split.** Five stacked pull requests; migration `0097` in
   PR1 and `0098` in PR4. As recommended.
9. **OQ8 (a) — buses.** Bus nodes are passive (`roleCode: null`); a bus frames
   as the worst downstream switch. As recommended.
10. **OQ9 (a) — compact size.** A `compact` config flag on the preset arm. As
    recommended.
11. **OQ10 (a) — the demo data.** `CR-Q9` trips (`breaker_main` 0,
    `breaker_trip` 1, 0 kW); `CR-Q11` stays OPEN. As recommended.
12. **OQ3b follow-on N1 (a) — library breaker symbols.** The two library
    symbols switch too: `MIMIC_SWITCHING_SYMBOLS = ["breaker", "wmpid:breaker",
    "drawio:circuit-breaker"]`, one constant. As recommended.

### Stock order with `F3.77`

ADR 0087 Amendment 3 ruling 10 (accepted and merged as #684) gives the stock
versions in this order. `F3.77` takes stock **v3** and makes the seed-upgrade
predicate general. `F3.74` PR5 takes **v4**, after `F3.77` merges, and places
the compact SLD in the left half of the row below the alarms rail. PR1 to PR4
do not touch `smoc-standard.ts` or `site-layout-seed-upgrade.ts`. This amends
decision 12 only in its version number.

### Plan decisions (approved by the owner on 2026-10-01)

- **D1 Seed-owned rows.** The three state rows are written by the seed
  (`ON CONFLICT (point_key_code, value) DO UPDATE`), not by the migration.
- **D1b Units-only `CHECK` and symbol-based switching.** The constraint
  `mimic_layout_nodes_flags_units_check` allows either flag only on a `unit`.
  A unit switches by its symbol, with no column.
- **D3 Tone order and one walk.** A state derives as offline, then tripped,
  then open, then closed, else unknown. One shared function, `energiseGraph`,
  serves both arms.
- **D4 OR join.** Two paths to one node join as OR: energised, else unknown,
  else de-energised.
- **D5 The parity difference.** A fan-out node's outgoing pipe is OR over its
  members, so with `CR-Q11` OPEN and `CR-Q10` CLOSED the HVAC branch still reads
  energised. The SMOC SLD pairs members; this record does not.
- **D6 The passive-bus rule and the dash colour rule.** A passive unit with a
  switching unit directly downstream frames as the worst downstream switch, on
  both arms, with no flag. An energised pipe animates in the accent colour only
  when its energy is energised or the graph has no sources.
- **D9 Stock v4 after `F3.77`.** As in the section above.
- **D11 The forced role write.** The demo seed forces the `CR-Q*` membership
  roles at `RSMOC-WC` (`SET role = EXCLUDED.role`), because the existing upsert
  keeps the old role. It touches that site only.
