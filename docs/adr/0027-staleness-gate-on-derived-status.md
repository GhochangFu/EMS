# ADR 0027 — Staleness gates every derived status and every rendered value

## Status

Accepted

## Context

`F4.37` fixed the arithmetic that let a future-dated timestamp pin an asset
`running`, and in doing so established where freshness is actually consulted in
the web client: `deriveStatus` in `apps/web/src/lib/schematic-telemetry.ts`,
reached by the SVG schematics through `useSchematicTelemetry`.

Nothing else consults it. Measured on `main` at `17d3085`:

1. Each of the seven control-room pages derives its tile status locally —
   `deriveRuleState` on five, `deriveRuleStatus` on `-it-`,
   `deriveBreakerRuleState` on `-sld-`.
2. **None of them treats `lastSeenMs` as a clock.** `-env-` and `-hvac-` check
   only `lastSeenMs === null` ("has this asset *ever* reported"); the other five
   never reference it. `-ups-` and `-battery-` derive `offline` from
   `slice.breaker === 0 || slice.healthPct === 0`, which are **frozen
   last-known values**, not evidence of contact.
3. So once an asset has reported once, its tile never returns to `offline`. It
   keeps rendering its last reading, and the page's threshold rules keep
   evaluating against it.
4. `ctx.totalKw` sums each slice's `kw`/`coolingKw` with no staleness gate
   either, so a dead asset keeps counting into the SLD bus MW header.
5. There are four status vocabularies. `UpsStatus`, `BatteryStatus`,
   `RackPowerStatus`, `HvacStatus` and `EnvStatus` carry `offline`; `CrStatus`
   (overview) and `BreakerVisualStatus` (sld) **have no `offline` member at
   all** — their fourth state is `open`, meaning breaker-open, which is a
   statement about the plant rather than about our knowledge of it.
6. Every page that merges statuses ranks them `critical` → `warning` →
   `offline`/`open` → `normal`.

The safety case is the Environment page: a leak or smoke sensor that dies while
reading `0` renders `normal`/dry indefinitely, and the rule engine keeps
asserting a `leak_state` it cannot know. This needs no clock skew, no unusual
producer and no attacker — it is the default behaviour for every dead sensor,
and it survives a reload.

`F4.38` was raised rather than folded into `F4.37` because the fix is not an
engineering judgement. What a stale-but-last-known-critical sensor should
display changes what a control room does at 3 a.m., and that belongs at the
human gate.

## Decision

**Decisions 1–5 were answered by the repository owner at the §10 gate on
2026-08-14.** Decisions 6 and 7 are implementation placement, recorded here
because they are cross-cutting, not because a human chose them — an earlier
draft of this ADR filed all seven under the gate, which over-attributed.

1. **Staleness outranks every value-derived state.** A stale tile reads
   `offline`, including when its last reading was `critical`. Rationale: the
   honest statement is that we no longer know. A frozen `leak_state: 1` is not
   evidence of a leak now.
2. **`offline` outranks `critical` in `mergeStatus`**, so a page banner reports
   `OFFLINE` rather than `CRITICAL` when its assets have stopped reporting.
3. **A stale tile does not render its last numeric values.** They are replaced
   by `—`. Rationale: a number with no timestamp beside it is precisely what
   makes this failure invisible today.
4. **`totalKw` excludes stale slices, and the total is flagged** with the count
   excluded (e.g. `412 MW · 2 assets stale`). A sum that silently includes dead
   assets is wrong in the direction of reporting load that is not there; a sum
   that silently drops them is unexplained. The flag is what makes the drop
   legible.
5. **`CrStatus` and `BreakerVisualStatus` gain an `offline` member.** `open` is
   not reusable for this: it means the breaker is open, which is knowledge about
   the plant, and overloading it would make "we cannot see this asset" and "this
   asset is disconnected" indistinguishable on the two pages where breaker state
   matters most.
6. **The gate lives in `apps/web/src/lib/schematic-telemetry.ts`** and reuses
   `isStale` — already tested, already the single definition of `FRESH_MS`. No
   page defines its own freshness window or its own timer.
7. **`staleTick` is a precondition, not an optional extra.** A page-level
   staleness check is only re-evaluated when something re-renders, and without
   the `F4.37` tick that is an incoming socket payload — the very signal that
   stops during the outage this exists to show. Pages take the tick from the
   provider; none of them starts its own interval.

### Consequence of decision 2 that was raised at the gate, and the mitigation

Ranking `offline` above `critical` means **one dead sensor turns the banner
`OFFLINE` while a different, live sensor is genuinely critical** — a real alarm
masked by an unrelated comms fault. The decision stands as taken, and the
masking is closed by making the count visible rather than by re-ranking: every
page that merges statuses shows a live critical count alongside the banner, so
a genuine alarm is never invisible even when the banner reads `OFFLINE`.

That claim was **false when first written** — the count reached only four of the
six merging pages, and the two it missed were `-overview-` (the main dashboard,
which merges every domain including leak and smoke) and `-it-`. Found by the
`F4.38` compliance review. It is now on all six and is held by a repo invariant,
because a claim of this kind in a safety path should not depend on a reviewer
noticing.

## Dependencies

None. No new npm package; the gate is arithmetic over data the client already
holds.

## Consequences

- Seven pages change status derivation; two of them gain a status member and
  the label / pill / tile / marker functions that render it.
- **Do not rely on the compiler to enumerate those call sites.** An earlier
  version of this ADR said the switches are exhaustive so `tsc` would find them
  all. Only four functions across two pages are exhaustive `switch`es; every
  other renderer is an `if`/ternary chain **whose default is the healthy green
  branch**. Adding a union member therefore compiles silently and renders the
  new state as *normal*: the review found a dead breaker's table row reading
  `CLOSED`, and dead feeders drawn as energised green paths on two SLDs. When
  adding a status, grep the renderers; test `offline` first in every chain.
- **Dashboards will show more `offline` than before, and some of it is real
  backlog rather than regression.** Any asset the simulator or pilot is not
  currently feeding becomes visibly offline instead of silently frozen. That is
  the point, but it changes what a demo looks like.
- The rule engine still evaluates thresholds against stale slices on the
  server; this ADR governs the **web client's** rendering only. Server-side
  alarm evaluation over stale readings is a separate question and is not
  decided here.
- `F1.7` (clamp `sample.at` at ingest) remains the upstream repair for
  future-dated rows; nothing here depends on it.
