# ADR 0101 — Network mimics: switching units, flow tones and a live demo (`F3.80`)

## Status

Accepted — drafted on 2026-10-14, before any implementation code. Seven scope
questions and one follow-up were put to the owner one at a time on
2026-10-14; each ruling is recorded under *Gate questions*. The owner approved
this written record on 2026-10-14, with the step-3 plan held until the owner
starts it.

Implements row `F3.80`. Amends
[ADR 0081](./0081-mimic-layout-builder.md) decision 10,
[ADR 0082](./0082-mimic-domain-symbols-and-presets.md) decisions 6 and 7 and
[ADR 0088](./0088-live-breaker-state-on-the-electrical-mimic.md) decision 2,
decision 5 and Amendment 1 rulings 4 and 12 (see *Amended records*). Promotes
nothing out of `AGENTS.md` §6.

## Context

`F3.80` was raised by the `F3.32` closure with two open questions: which
networks come into scope, and whether a drawn layout (not only a preset) can
carry breaker state and energised paths.

**The second question is already answered.** ADR 0088 Amendment 1 ruling 4
(OQ3b "Full") gave `bms.mimic_layout_nodes` the `fan_out` and `is_source`
columns (migration `0097`), and "the energised walk runs on layouts as on
presets". "Start from `lv_single_line`" yields a working single-line layout
today (spec S11, `mimic-scene.breakers.spec.tsx`). The research for this
record (read-only at `origin/main` `149ca95f`) found the gaps that stop a
drawn *network* from working:

- **Only three symbols switch.** `MIMIC_SWITCHING_SYMBOLS`
  (`packages/shared/src/breaker-state.ts`) is `breaker`, `wmpid:breaker` and
  `drawio:circuit-breaker`. Isolators, switch-disconnectors, about 80 valve and
  damper symbols across the `drawio`, `mdi`, `qet` and `wmpid` libraries, and
  every uploaded `org.<code>:<name>` symbol can never gate the walk. Many of the
  valve symbols (check valves, safety valves) have no position to show, so a
  wider symbol list is a weak rule.
- **Binding is by membership role only.** Two units show two devices only when
  the devices carry two roles. The seeded roles have five breaker positions
  (the `lv_single_line` set) and no HT, coupler, isolator, DG-breaker, valve or
  damper role.
- **The tones are electrical words.** `point_key_states.tone` is
  `closed | open | tripped` (a `z.enum` and a `CHECK`), and the pill text is a
  fixed table per derived state (`BREAKER_PILL`). A valve that passes flow is
  *open*; on the breaker tones it would read "CLOSED".
- **No graph check at save.** A layout with switching units and no source
  saves, and `energiseGraph` returns `null` — the operator sees only the
  freshness dash, with no message.
- **No demo data.** No seeded asset reports a valve or damper position, and no
  ESKOM site has HT switchgear.

The algorithm needs no change. `energiseGraph` is a monotone fixpoint with a
step bound over directed pipes and declared sources: rings, two sources and a
bus coupler (two reverse pipes) are already legal input, and
`aCycleTerminates` covers a cycle.

## Gate questions

Ruled by the owner on 2026-10-14, one at a time.

1. **Q1 Scope.** Options: generic electrical; electrical plus valves and
   dampers; electrical plus a page-9 preset; docs-only close. Recommended:
   generic electrical. **Ruled: electrical plus valves and dampers** — the same
   walk gates flow in water and HVAC layouts.
2. **Q2 Which units switch.** Options: a per-unit flag plus the breaker
   symbols; a wider symbol list; the flag replaces the symbol rule.
   **Ruled: a per-unit flag plus the breaker symbols** (as recommended).
3. **Q3 Binding.** Options: seed position roles; roles stay data only; a unit
   names an asset. **Ruled: seed position roles** (as recommended).
4. **Q4 State vocabulary.** Options: add flow tones; the pill shows the row
   label on the three tones; only breakers get states. **Ruled: add flow
   tones** (as recommended).
5. **Q5 Save checks.** Options: editor warnings only; the API refuses with
   400; none. **Ruled: editor warnings only** (as recommended).
6. **Q6 Starter shape and demo.** Options: none; a new HT/LT preset; a seeded
   live demo. Recommended: none. **Ruled: a seeded live demo.**
   - **Follow-up — where and what.** Options: ESKOM with two networks; ESKOM
     HT/LT only; a new Ion Exchange demo organization. **Ruled: ESKOM, two
     networks** (as recommended). PHEWB is the real ingestion pilot and gets no
     demo data.
7. **Q7 The `F3.87` seam.** Options: move the layout write schemas to
   `packages/shared` in `F3.87`; move them in `F3.80`. **Ruled: in `F3.87`**
   (as recommended).

## Decision

### Scope

1. **A network mimic is any drawn layout whose switching units gate the walk**
   — electrical (LV, MV, HT, ring, DG) and flow (water, HVAC). This record
   names no fixed list of networks. Display only: no breaker or valve command
   (ADR 0088 decision 1; the command path is `F3.12`).
2. **Unchanged from ADR 0088:** binding by membership role only; assets carry
   no topology; pipes stay directed; sources are declared, never inferred; a
   fan-out node gates with OR; the walk runs in the web and the API never
   returns a derived state; unknown and offline never look energised
   (ADR 0027); the freshness dash stays. The caps stay: fan-out 16, 120 nodes,
   160 pipes. No ATS or changeover logic — a changeover is two switching units.

### Switching units

3. **`bms.mimic_layout_nodes.is_switching`**, `boolean NOT NULL DEFAULT false`,
   units only — the same units-only `CHECK` pattern as `fan_out` and
   `is_source` (ADR 0088 D1b). A new migration adds it; `0097` stays frozen.
4. **The rule.** A layout unit switches when `is_switching` is true **or** its
   symbol is in `MIMIC_SWITCHING_SYMBOLS`. A preset node still switches by its
   glyph. Existing layouts keep their behaviour with no data change.
5. **The editor** gains an inspector toggle, "Switches (gates the flow)", for a
   unit. A unit drawn with a breaker symbol shows the toggle on and locked, with
   a note that the symbol switches it. "Start from" a preset copies no flag: the
   breaker glyphs map to the `breaker` symbol, which switches.
6. **The contracts** (`mimicLayoutNodeSchema` and the write bodies) gain
   `isSwitching`. A panel or a label with `isSwitching: true` is refused with
   400, as `fanOut` and `isSource` are.

### Roles and the breaker table

7. **Eight position roles** are seeded into `bms.asset_roles` by the same
   migration: `ht-incomer-breaker`, `ht-outgoing-breaker`, `bus-coupler`,
   `isolator`, `dg-breaker` (electrical) and `isolation-valve`,
   `control-valve`, `damper` (flow). Codes are final at the plan; the global
   admin can add more through the existing vocabulary route.
8. **The breaker table** (`breaker_table`, `breaker-rows.ts`) keeps one fixed
   list: `BREAKER_ROLE_CODES` widens to the five existing breaker roles plus the
   five electrical position roles above. **Valves and dampers stay off it** —
   its columns (rating, current, kW, kWh, trip cause) are electrical. The table
   keeps its name.

### Flow tones

9. **The tone vocabulary widens** to `closed | open | tripped | flowing |
   shut` — the `z.enum` in `contracts/point-key-states.ts` and the `CHECK` in
   the new migration together.
10. **New point keys and state rows.** Two discrete global point keys,
    `valve_open` and `damper_open`, go into `bms.point_keys` (the state rows
    reference it), each with two state rows: 1 → `OPEN` / `flowing`, 0 →
    `SHUT` / `shut`. A DG feeds through a `dg-breaker` unit that reports
    `breaker_main`; `dg_on_load` gets no state row.
11. **The derived state** (`deriveBreakerState`) gains `flowing` and `shut`.
    Stale still wins (`offline`). Among matched points the rank is
    `tripped` > `shut` > `open` > `flowing` > `closed`: a fault first, then a
    blocking position, then a passing one. No match stays `unknown`.
12. **The walk gate** (`energiseGraph`): any member `closed` or `flowing`
    passes; no members or any `unknown` gives unknown; otherwise (all `open`,
    `shut` or `tripped`) blocks.
13. **The look.** The frame precedence (ADR 0088 decision 5) becomes: offline,
    tripped, open or shut, the worst alarm tone, closed or flowing. `shut` takes
    the `open` look and `flowing` the `closed` look. The pills read `OPEN` for
    `flowing` and `SHUT` for `shut`; the breaker pills do not change.

### Editor warnings

14. **The editor warns, the API does not refuse.** On a layout with at least
    one switching unit, the editor lists: no source unit; a switching unit with
    no role; a switching unit that no source reaches along the pipes. The
    warnings do not block a save, and existing layouts save as before.

### Live demo

15. **ESKOM gets two demo networks** (an exception to ADR 0082 decisions 6
    and 7, which ruled "no seed change"):
    - **HT/LT electrical**, in the Ion Exchange page-9 shape: a grid incomer
      and a DG into an HT panel with a bus coupler, two transformers, two LT
      panels and their feeders. The units bind to the decision 7 roles.
    - **Water/HVAC flow**: a pump line with isolation valves, a control valve
      and a damper.
    The seed adds the assets, the group members with their roles, the two
    layouts and a dashboard place for each, joined to existing ESKOM
    locations. It is idempotent and keeps the compose re-seed count checks
    true.
16. **The simulator** drives the new points: `breaker_main` and `breaker_trip`
    on the HT breakers (the coupler held open), and `valve_open` and
    `damper_open` on the flow units (one valve held shut), so both networks
    show a blocked branch next to a live one. On the AWS demo the simulator runs
    when the owner starts it (ADR 0096).

### The `F3.87` seam

17. **The layout write schemas stay in the API for this row.** `F3.87` moves
    `createMimicLayoutBodySchema` and `putMimicLayoutBodySchema` to
    `packages/shared` when its catalog entry needs them by identity
    (ADR 0099 decision 12). The seam it inherits: a write node carries
    `fanOut`, `isSource` and `isSwitching`; `PUT` replaces the whole layout and
    needs `version`; node keys stay stable; `symbolLibraries` lists every
    library a unit's symbol uses.

### Out of this ADR

18. Free shapes and free lines, connector styles per domain, per-unit colours,
    layouts in templates (`F3.81`), layouts shared across organizations
    (`F3.83`), a live preview of state in the editor, an API refusal of a bad
    graph, new tones beyond these five (`earthed`, `racked_out` — until a real
    device sends them), and drawing by conversation or from an image (`F3.87`,
    with its own ADR 0099 amendment).

### Amended records

19. This record amends:
    - **ADR 0081 decision 10** and **ADR 0079 decision 8** — network mimics
      are no longer out; this record holds them.
    - **ADR 0082 decision 6** ("No seed change") and **decision 7** ("new seed
      data", "network mimics … stay out") — the decision 7 roles and the
      decision 15 demo seed are exceptions.
    - **ADR 0088 decision 2** — the tone set widens (decision 9).
      **Decision 5** — the frame precedence (decision 13).
      **Amendment 1 ruling 4 and ruling 12 / D1b** — "a unit switches by its
      symbol, no column" becomes the decision 4 rule.
    - **ADR 0087** context (lines 52–54) and the `F3.80` backlog row — the
      text that keeps live state out is overtaken.

### Build

20. **Pull requests**, each merged on green CI under the owner's standing
    permission for `F3.80` once this record is approved:
    - **PR1 — db and API:** the migration (the column, the eight roles, the two
      point keys and four state rows, the widened tone `CHECK`), the contracts,
      the layout read and write, and the wider `BREAKER_ROLE_CODES`.
      `migration-reviewer` and `security-reviewer` read it.
    - **PR2 — shared and web:** the derived state, the walk gate, the looks and
      pills, the inspector toggle and the editor warnings, with walk specs for
      two sources with the coupler open and closed, and a valve line.
    - **PR3 — demo:** the ESKOM seed and the simulator points.
    - The closure, then a separate `chore(agents):` sweep.

## Consequences

- Any organization admin can draw a live HT, ring, DG or water network from a
  blank canvas with library or uploaded symbols, and it shows position and
  energised or flowing paths. The step-3 plan may merge or split the PRs above;
  it may not move work across the db/API and web boundary without saying so.
- Two units that show two devices still need two roles. A site with three
  isolation valves in one group needs three roles or three groups — the
  role-only rule (ADR 0081, ADR 0088) is kept on purpose for `F3.81`.
- A layout can still be saved with a broken graph; the editor only warns.
- The ESKOM seed grows. A fixture that counts ESKOM assets or roles moves with
  it in PR3.
- `F3.87` follows this row and gains `isSwitching` and the flow tones in its
  catalog without further scope work.
