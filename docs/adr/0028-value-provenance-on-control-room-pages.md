# ADR 0028 — Every rendered value declares its provenance

## Status

Accepted

## Context

`ADR 0027` made staleness reach every value on the seven control-room pages: a
tile whose asset has stopped reporting renders `offline`, its numbers blank to
`—`, and aggregates exclude it and say how many they excluded.

That gate answers one question — *is this reading current?* — and it assumes the
thing on screen is a reading at all. Verifying `F4.38` against the running
deployment showed the assumption is false often enough to matter. With the whole
estate offline and twelve breakers correctly reading `OFFLINE`, two battery
strings still displayed a confident `384 V` / `386 V`. Those are string
literals in the SVG. There is nothing to go stale, so no staleness gate can ever
reach them.

Censused on `main` at `83677e1`, across all seven pages. `F4.39` as originally
written said "5 literals on the SLD, 3 on HVAC, none on the other five pages
(measured by grep)". **Both halves of that are wrong**, and the correction is
the reason this ADR exists rather than a one-line fix:

1. Static values appear on **five** pages, not two — `-it-` (`UPS-1 · 30 kVA`),
   `-ups-` (`32 cells · 12V VRLA`, `STATIC SW · NORMAL`) and `-overview-`
   (`rated={3}` / `rated={2}`) as well as `-sld-` and `-hvac-`.
2. Most of those five are **nameplate data, and static is the correct
   behaviour** for them. `XFMR 100 kVA` is what is bolted to the wall. Counting
   them as defects would be as wrong as counting none of them.
3. The census found a class the row missed entirely, and it is the worst one.

That class is **values synthesized from real telemetry and labelled as a
different measurement**. Three instances:

- `control-room-sld-page.tsx:188-189` — "Voltage Y" and "Voltage B" are the
  measured R-phase reading `+ 0.7` and `- 0.8`.
- `control-room-battery-page.tsx` — the 32-cell grid per string, every cell
  voltage and temperature synthesized from the string's own `batteryV` /
  `batteryTempC` plus a per-string seed.
- The same grid's per-cell tooltips.

These are not what `F4.39` describes. `F4.39` is about values the staleness gate
*cannot reach*; these are values the gate **does reach and gates correctly** —
they blank when the source dies, they move when the real reading moves. Every
mechanism `F4.37` and `F4.38` built works on them exactly as designed, and they
are fabricated anyway. A static `384 V` at least sits inert on the page. A phase
voltage that tracks R at a fixed offset, or 32 individual cell voltages that
respond to the string, look like working instrumentation. The battery grid was
already described in a code comment landed with `F4.38` as "the most convincing
fake live data on the page" — it was seen, and left, because relabelling is a
product decision.

**The owner folded this class into `F4.39` at the §10 gate on 2026-08-15**
rather than raising it separately, on the condition that the row be rewritten to
say so.

## Decision

**Decisions 1–3 were answered by the repository owner at the gate on
2026-08-15.** Decisions 4–8 are implementation placement, recorded here because
they are cross-cutting, not because a human chose them.

1. **Values with a real source are wired to it.** `CR-BATT-1` / `CR-BATT-2` are
   already in `CR_TRACKED_ASSET_CODES`, so the SLD's provider already carries
   their slices — the battery boxes read `batteryV`. The `ONLINE`, `RUN · LEAD`
   and `STANDBY` words come from the rule state already derived on the page.
2. **Values with no source are removed or explicitly marked**, never left
   looking like readings.
3. **Nameplate and configuration data render through one shared marker
   component**, visually distinct from live readings.
4. **A value may be labelled as a measurement of X only if it comes from
   telemetry that measures X.** This is the line between legitimate derivation
   and fabrication, and it is not "was arithmetic involved":
   - `kVA` from `kW` and `pf` is legitimate — a real relation between quantities
     of the same circuit, and the inputs are measured.
   - "Voltage Y" from Voltage R is not. It asserts a second measurement of a
     different conductor that no instrument reported.
   - 32 cell voltages from one string voltage is not. It asserts 32
     measurements where there is one.

   Consequently `Voltage Y`/`Voltage B` are dropped rather than relabelled — the
   SLD header shows the phase that is actually metered — and the battery cell
   grid is marked `simulated`, because it is a deliberate demo visualisation
   with no per-cell points behind it in any RTU profile.
5. **Four provenance kinds**, exhaustive, and the type is a union so a new kind
   is a compile error rather than a silent default (the `F4.38` lesson about
   ternary chains with a healthy default applies here too):
   `measured` · `derived` · `nameplate` · `configuration`, plus `simulated` for
   demo visualisations that must never be mistaken for either.
6. **Pure logic lives in `apps/web/src/lib/value-provenance.ts`**, for the same
   reason `ADR 0027` put freshness in `lib/` — `vitest.config.ts` counts only
   `apps/web/src/lib/**` toward web coverage, so anything above it is invisible
   to the gate. The marker component itself is presentational and sits in
   `apps/web/src/components/`.
7. **Markers qualify values, not labels.** A static number is *not* marked when
   its form already says it is not a reading:
   - a denominator in a capacity pair — `2.41 kW / 3.0 kW`, `18/24 outlets` on
     `-overview-`;
   - a heading or identifier — `UPS-1 · 30 kVA` on `-it-`, `AC-1 · 4 TR · LEAD`
     on `-hvac-`;
   - a `KpiTile` hint, which is subordinate text under a value that is itself
     marked or measured.

   This is why the census counted five affected pages but only three changed.
   Marking every one of these would put a badge on roughly half the text on the
   page, and a marker that appears everywhere stops being read — which would
   cost exactly the honesty the marker exists to buy.
8. **The repo invariant checks for the marker, not against literals.** "No
   numeric literal in JSX" is unenforceable when nameplate and setpoint values
   are legitimate — it would have to be suppressed everywhere it fired. Checking
   that known static values render through the wrapper is enforceable, and it is
   scoped to the construct rather than the file, per the `F4.38` finding that a
   file-wide token search is defeated by an unrelated call in the same file.

## Consequences

- The SLD header drops from six meters to five. Deliberate: three phase columns
  where one phase is metered is worse than one honest column.
- The battery cell grid stays on screen and is marked. Removing it would delete
  a visualisation operators use to see cell balance in the demo; keeping it
  unmarked asserts instrumentation that does not exist. Wiring it is out of
  scope — it needs per-cell points in the RTU profile, which is an ingestion
  change, not a UI one.
- HVAC `Health 96%/82%`, `Elapsed 96 / 168 h` and `Imbalance 452 h · within 5%
  tolerance` are removed. They have no source, and unlike run-hours they are not
  plausible as maintenance records — a health index in particular reads as a
  computed diagnostic.
- HVAC `runHours` and `Last service` stay, marked `simulated`: they are
  maintenance data, and the maintenance module (`work-orders`,
  `maintenance-schedules`) is where they would come from. Wiring them is a
  separate item, not this one.
- `Setpoint 22.0 C`, `Changeover interval 168 h` and `Trip response < 30 s` stay
  as `configuration`. They are static today and correctly so; when setpoint
  writeback lands they become `measured`-adjacent and the marker changes with
  them.
- This ADR does not add a dependency, a table or a route. It constrains how the
  web client labels what it already renders.
