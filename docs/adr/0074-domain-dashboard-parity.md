# ADR 0074 — Domain dashboard parity with the client reference layout (`F3.28`)

## Status

Accepted — drafted at the §10 gate on 2026-09-24, before any implementation
code. Ten gate questions and one follow-up (1b) were put to the owner one at
a time. Ten were ruled as recommended. **Q1 was answered outside its
options**: the light canvas stays the default, and end users get a light/dark
switch; follow-up 1b placed that switch in a new row (`F3.65`) with its own
ADR. The rulings are recorded under *Gate questions* and carried into
*Decision*. Six points were decided without a question and are listed under
*Ruled here without a question*. The owner approved the merge of this record
on 2026-09-24 (PR #541).

Resolves the `docs/BACKLOG.md` §5 row *Reference layout language* ⚠ (Q1).
Promotes nothing out of `AGENTS.md` §6 — `F3.28` is a backlog row, not a §6
item (ADR 0047 decision 6, ADR 0067). The `chore(agents):` sweep owed is the
`AGENTS.md` §5 pointer that BACKLOG §7 has recorded as owed since 2026-08-16,
now to this ADR and to `docs/ux/ion-exchange-reference-alignment.md`, plus the
status line — as a separate PR (§9.10).

## Context

**The row names eight affordances, and one open §5 decision gated all of
them.** `F3.28` was created on 2026-08-16 by the BACKLOG §7 comparison with the
client's reference dashboards (SOW pp. 9–10). The §5 row said only the canvas
colour was gated; every affordance works in the light palette. The region
reading is `docs/ux/ion-exchange-reference-alignment.md` L68–L104 and
L155–L164.

**What the source says today** (read 2026-09-24 at `050498fd`):

1. **`/cr-overview` has no link to `bms.alarms`.** Its right rail,
   `ActiveRulesPanel` (`apps/web/src/pages/control-room-overview-page.tsx`
   L701–740), derives "Active Rule Warnings" in the browser from
   `GET /api/v1/rules` and live telemetry (`deriveRuleState`, L131–160). The
   page binds about 40 literal Eskom `CR-*` asset codes (L232–269,
   `components/live-svg/control-room-bindings.ts`). It is 971 lines and has no
   spec file; only `tests/repo-invariants.test.ts` L693–836 touches it.
2. **`GET /api/v1/alarms` has no active filter.** It returns every readable
   alarm, newest first (`apps/api/src/alarms/alarms.service.ts`). The one
   active-only list is the `alarms.active` metric-catalog dataset, reachable
   only through a dashboard's catalog values. `/ws/alarms` already pushes
   `created | acknowledged | cleared` events filtered to readable assets
   (`alarms.gateway.ts`).
3. **An alarm row stores only `message`.** `bms.alarms` has no trigger value,
   threshold or unit (`packages/db/src/schema/alarms-schema.ts`). The single
   writer is `AlarmRaiser.raise`, which calls
   `composeAlarmMessage(rule, value)` (`apps/api/src/rules/alarm-message.ts`
   L27–46); `tests/repo-invariants.test.ts` L922–968 enforces the single
   writer. Four special cases already put the value in the text; every other
   rule falls back to `` `${rule.name} matched at ${value}` `` — raw value, no
   unit. ADR 0034 decision 5 gives the composition of `message` to `F3.28` and
   forbids a second writer.
4. **The period delta exists for one point over a rolling window.** `F3.35`
   (ADR 0048 decision 6) built `compareToPrevious`, `formatDelta` and the
   `KpiTile` hint slot (`apps/web/src/lib/widget-value.ts`). The prior value
   comes from `GET /api/v1/telemetry/points/:pointRef/aggregate?compare=true`:
   one point, the trailing window against the window before it. The `/`
   ribbon (`dashboard-page.tsx` L120–166: Total load, Sites online, Open
   alarms, PUE) and most `/cr-overview` tiles sum many assets. No read returns
   a value "at the same time yesterday".
5. **No asset class column exists.** `bms.assets` has `domain` and
   `template_id`; every seeded `CR-*` asset has a null template. The class
   vocabulary that exists is ADR 0049's `bms.asset_roles`, carried on
   `asset_group_members.role`; ADR 0049 *Consequences* names `F3.28`'s class
   strip as a consumer. The seed gives the electrical `CR-*` assets roles
   (`CR-Q\d+` → `mcc`, `UTILITY` → `incoming-supply`, and more); UPS, HVAC,
   battery and environment assets have none. No read returns counts per role.
6. **No state legend, no list view of the diagram, no `high` severity.**
   `bms.alarm_severities` holds `info` / `warning` / `critical` (ADR 0032);
   `high` waits on the client's B9 answer. The nearest list of the diagram's
   nodes is `BreakerTable` on `/cr-sld`
   (`control-room-sld-page.tsx` L518–588).
7. **The gauge widgets exist.** `radial_gauge` and `tank_level` are ADR 0047
   types with presentational renderers (`components/widgets/`); a fixed page
   can pass a literal config and a value.
8. **The app has no dark styles.** Zero `dark:` classes in `apps/web/src`;
   every page uses fixed colours (`bg-white`, `text-bms-ink`).

## Gate questions

1. **The §5 *Reference layout language* decision.** Options: keep light,
   leave it open, adopt the dark canvas. Recommended: keep light. **Ruled
   outside the options: light is the default now, and end users must be able
   to switch between light and dark.** The owner's words: *"We will follow
   the light canvas, but there should be a option of going back to the dark
   canvas as well. So both the options should be there and the system system
   must have a provision for the end users so that they can switch between
   light and dark."* This is the provenance of `F3.65`.
1b. **Where does that switch work live?** Options: a new row with its own
   ADR, inside `F3.28`, or colour tokens on `F3.28`'s surfaces only.
   **Ruled as recommended: a new row with its own ADR** (`F3.65`).
2. **Which page changes?** Options: in place with reusable parts, extract a
   domain-page shell, or a new plant Electrical page. **Ruled as recommended:
   in place on `/cr-overview` and `/`, each affordance a standalone
   component.**
3. **How does the breach value reach the alarm text?** Options: compose on
   write, a new `trigger_value` column composed on read, or a read-time join
   to `rule_executions`. **Ruled as recommended: compose on write.**
4. **What feeds the alarms rail?** Options: an active filter plus a summary
   read, the filter only, or a browser-side filter. **Ruled as recommended:
   `state=active` on the list and an active-count-by-severity read.**
5. **Which alarms does the rail on `/cr-overview` show?** Options: the page's
   assets, or everything readable. **Ruled as recommended: the page's
   assets**, through an optional asset filter.
6. **What does the period delta compare?** Options: same time yesterday,
   rolling 24 h against the 24 h before, calendar today against yesterday.
   **Ruled as recommended: the same instant 24 h ago, computed on the
   server, only on tiles with a stored history.**
7. **The two executive KPIs ADR 0072 decision 7 hands to `F3.28`.** Options:
   defer to the B14 row, or add them as empty tiles. **Ruled as recommended:
   defer.**
8. **What is an asset class, and where is its worst state computed?**
   Options: roles with a server read, roles with browser state, or the
   template `asset_type`. **Ruled as recommended: the ADR 0049 role, with a
   server read on the same alarm source as the rail.**
9. **The pull-request split.** Options: three vertical slices, API then web,
   one PR. **Ruled as recommended: three serial vertical slices.**
10. **How do the `/cr-overview` tiles get their value from 24 h ago?** Those
    tiles are composed in the browser from live values of named assets, and
    no server read computes them. Options: a batched value-at-instant read
    the page composes over, a delta on `/` only, or a `/cr-overview`-specific
    server endpoint (the tile formulas then exist twice). **Ruled as
    recommended: the batched value-at-instant read.**

## Decision

### 1. The light canvas stays; the user switch is `F3.65` (Q1, Q1b)

The §5 row is resolved: light is the default canvas. A user-selectable dark
theme is wanted and is a new row, `F3.65`, with its own ADR — the colour-token
layer across every page, where the choice is stored (per browser or per user),
and the dark palette. `F3.28` does not wait for it. `F3.28` builds in the
existing light palette, adds no `dark:` classes, and builds no token layer of
its own; a second, partial token scheme would be the thing `F3.65` has to
unwind.

### 2. In place, with standalone components (Q2)

`F3.28` changes `/cr-overview` and `/`. It extracts no page shell: one
consumer does not justify one, and `E5.1` (water, STP, ETP pages) is the row
that will compose a second instance. Each affordance is a component that
takes its data as props or through its own hook with an explicit asset set,
so `E5.1` can place it without editing it. The Eskom `CR-*` bindings stay.

**The first unit of the first PR is a characterization spec for
`/cr-overview`**, pinning the regions and tile states the page renders today,
before any of them moves. The borders stand: `E5.1` owns the water pages,
`F3.32` owns configurable mimics, `F4.47` owns diagram navigation.

### 3. The breach value is composed on write (Q3)

`composeAlarmMessage`'s fallback becomes `<rule name> (<value><unit>)` — the
reference shape, "Oil Temperature High (65.3 °C)" — with the value rounded by
one pure, unit-tested formatting rule and the unit from `condition.unit`
(omitted when null). The four special cases are unchanged. `AlarmRaiser`
stays the only writer, and the repo invariant stays as it is. Rows already
raised keep their text; there is no backfill. **"Overload (112%)" is not
produced**: it is a percentage of a rating, and the engine does not know the
rating. ADR 0034's Details fields are not touched.

### 4. Two alarm reads and the rail (Q4, Q5)

- `GET /api/v1/alarms` gains `state` (`all` | `active`, default `all`, so every
  existing caller is unchanged) and an optional, bounded `assetIds` list.
  `active` is `cleared_at IS NULL`, the ADR 0057 meaning. `assetIds` is
  intersected with the caller's readable assets; it never widens a read.
- A new read returns active-alarm counts per severity code, ordered by rank,
  for the same optional `assetIds`.
- Both contracts are Zod schemas in `packages/shared/src/contracts` and the
  types are inferred from them (ADR 0030).
- The rail replaces `ActiveRulesPanel` on `/cr-overview`: tabs *Active Alarms*
  (Time · Asset · Alarm · Severity, 8 rows, *View All* to `/alarms`) and
  *Alarm Summary* (the counts). It passes the page's resolved asset ids and
  refreshes on `/ws/alarms` events. The *Rule Warnings* KPI tile keeps the
  browser rule state.

### 5. The period delta is the same instant 24 h ago (Q6, Q7, Q10)

- **A prior value uses its live value's definition, evaluated at the earlier
  instant.** A delta between two different definitions measures the
  definitions, not the plant. Today `totalKw` is the sum over assets of each
  asset's latest raw `kw` sample in `telemetry.point_values`, with no
  freshness bound (`kw_latest`, `apps/api/src/dashboard/dashboard.service.ts`),
  and `pueEstimate` is `latestPueRatio` over the same raw relation
  (`apps/api/src/telemetry/pue-ratio.ts`). Their prior values are therefore
  the same reads restricted to samples at or before `asOf − 24 h` — not a
  continuous-aggregate bucket average. Raw retention is 730 days
  (migration `0028`), so the instant is always in range.
- `GET /api/v1/dashboard/kpis` gains a nullable prior value for `totalKw`,
  `alarmsOpen` and `pueEstimate` at `asOf − 24 h`. Open alarms count rows
  raised at or before that instant and not cleared by it. `sitesOnline` gets
  none — a live-state count has no stored history.
- A new bounded read returns, for a list of point references, each point's
  latest raw sample at or before a given instant. Each reference is checked
  against the caller's readable assets; the read never widens scope.
  `/cr-overview` applies its existing tile formulas to those values, the same
  way it applies them to live values. Tiles that count live states (*Rule
  Warnings*, *SLD Status*) get no delta.
- **No freshness bound, on purpose, for parity with the live read.** An asset
  that was silent yesterday contributes its older sample to the prior value,
  exactly as a silent asset contributes to today's `totalKw`.
- The tiles reuse `F3.35`'s `formatDelta` and the `KpiTile` hint slot. ADR 0048
  said `F3.35` builds the delta and `F3.28` uses it; the presentation is used
  as ruled, and the prior-value source is new because `F3.35`'s is one point
  over a rolling window. "vs yesterday" is the correct label for this
  comparison.
- **The two executive KPIs (Water Recycle %, Operational Efficiency %) stay
  off `/`.** They join the ribbon, with this delta, in the row that answers
  B14. ADR 0072 decision 7's hand-off moves there.

### 6. The class strip reads roles on the server (Q8)

- A class is an ADR 0049 role on `asset_group_members.role`. An asset with no
  role is not in the strip, and the strip says nothing about it.
- A new read returns, per role for an optional bounded `assetIds` list:
  `code`, `label`, `count`, the worst active-alarm severity (by rank, or null)
  and an offline count. `assetIds` is intersected with the caller's readable
  assets; it never widens a read. It uses the same alarm source as the rail,
  so the strip and the rail cannot disagree.
- **Offline must reuse an existing staleness definition.** If the API has none
  that fits, the plan raises it to the owner before building; it does not
  invent a threshold.
- The strip renders "MCCs 4 · 1 Critical", or "All Good" when there is no
  active alarm and nothing offline.

### 7. Three serial slices on one ADR (Q9)

1. **Alarms** — the characterization spec, the message fallback, `state` and
   `assetIds`, the summary read, the rail.
2. **KPI** — the `/dashboard/kpis` prior values, the point-at-instant read,
   deltas and icons on `/` and `/cr-overview`, and the stale *Unacknowledged
   rows* hint on `/` (the tile now counts `cleared_at IS NULL`).
3. **Page** — the class strip and its read, the legend, the Diagram / List
   toggle, the Key Parameters gauges, the footer ribbon.

Unit order inside each slice is the plan's (`plan-architect`).

## Ruled here without a question

1. **The legend is data, not a literal.** It lists `alarmSeverities` from
   `GET /api/v1/vocabularies` in rank order, plus *Normal* and *Offline*, so
   `high` appears the day the B9 `INSERT` lands. *Standby* is not shown; no
   state produces it.
2. **The List view reuses `BreakerTable`** from `/cr-sld`, extracted to a
   shared component. The toggle state is not persisted.
3. **Key Parameters uses the `F3.1c` renderers** with literal configs. No new
   widget type (ADR 0047: a fifth type is a new row). `/cr-overview` has no
   tank asset, so it shows radial gauges only.
4. **Tile icons come from the existing closed set** (`widgetIconSchema`:
   `alert`, `clipboard`, `bolt`, `drop`, `recycle`, `gauge`). A tile with no
   fitting icon has none; the set does not grow in this row.
5. **The footer capability ribbon is static copy** from the alignment document
   L104, on `/cr-overview` only.
6. **An asset that holds two distinct roles is counted under each** (decision
   6). A role lives on a group membership, so an asset in two groups can carry
   two. Counting it once needs a precedence between roles that no record
   defines; counting it under each shows the true state of each class.
   ADR 0049 Amendment 2 rules a different case — a role that matches more
   members than a widget can hold — and does not reach this one.

## Found in flight — raised, not fixed

- **`F4.154`**: `formatDelta` prints "vs yesterday" for every
  `compareToPrevious` tile, whatever its `windowMinutes`
  (`apps/web/src/lib/widget-value.ts` L175–215; the docblock records it as a
  copy gap). A 60-minute tile shows a false label. It is `F3.35`'s surface,
  not this row's; decision 5's tiles compare 24 h and are labelled correctly.

## Dependencies

None. Nothing under §9.4 moves.

## Consequences

- **No schema change and no migration.** Every new read is over existing
  tables and continuous aggregates. `migration-reviewer` does not apply.
- **Contract changes** (ADR 0030): the alarm list query, the alarm summary,
  the role summary, the point-at-instant read, and the `/dashboard/kpis`
  prior values.
- **Touched:** `packages/shared` (contracts), `apps/api` (alarms, rules
  message, dashboard KPIs, telemetry, a role summary), `apps/web`
  (`/cr-overview`, `/`, new components, `BreakerTable` extraction).
- **Old alarm rows keep "matched at" text** until they clear. The rail shows
  both shapes for a while.
- **The new message text reaches every reader of `alarms.message`**, not only
  the rail: the list and Details reads, the `alarms.active` catalog dataset,
  and the raise, escalation, reminder and cleared notifications that embed it
  (`apps/api/src/notifications/notifications.service.ts`,
  `apps/api/src/alarms/alarm-lifecycle.ts`). Each carries the text verbatim;
  none parses it, and the dedupe key is the rule and the alarm, not the text
  (`apps/api/src/notifications/dedupe-key.ts`).
- **The strip is electrical-only on the demo** until an admin gives other
  assets roles; the ADR 0049 vocabulary has no UPS or DG role.
- **New rows:** `F3.65` (the user light/dark switch, `Depends: ADR`) and
  `F4.154` (the delta label). `F3.64` loses its *Reference layout language*
  gate; its C19 gate stands.
- **`F3.28` keeps Wave `—`.** It was never scheduled into a wave; the §5 gate
  that held it is now resolved, and the row is started directly.

## Errata

### 1. The PUE read has a 900 s bound (2026-09-24)

Decision 5 says `pueEstimate` is read with no freshness bound, and that the
prior values carry none either. **That holds for `totalKw` only.**
`latestPueRatio` (`apps/api/src/telemetry/pue-ratio.ts`) ignores any
`site_kw` or `it_kw` sample older than `PUE_LATEST_MAX_AGE_SECONDS =
3 × DEFAULT_MAX_INPUT_AGE_SECONDS = 3 × 300 = 900 s` — the owner's ruling of
2026-09-06, which predates this ADR.

The owner's ruling OQ2 (2026-09-24) keeps the bound and moves it: the prior
`pueEstimate` reads samples in `(at − 900 s, at]`, where `at = asOf − 24 h`.
The live read keeps its one-sided `time > now() − 900 s`; the upper bound
applies only when `at` is given. `totalKw` and its prior stay unbounded, as
decision 5 states. Decision 5's text is left as written; this erratum is the
correction.

## Amendment 1 (2026-09-24) — closure: rulings the build needed

Written at the row's closure. The decisions above are left as written; this
records where the three pull requests (#542 `feat/F3.28-alarms`, squash
`5fcb5b9f`; #543 `feat/F3.28-kpi`, squash `14094473`; #545
`feat/F3.28-page`, squash `a42289e7`) and their reviews narrowed or ruled on
a point the decisions did not settle.

1. **Slice 2 review ruling — the `/` Total load delta.** The `/` ribbon's
   Total load delta keeps decision 5 as written: each site's prior uses its
   own live definition, so a site with no reading yesterday shows today's
   whole total as growth. `/cr-overview`'s tiles keep their own rule from
   decision 5 unchanged: no delta unless every live input feeding the tile
   also has a prior. The two are separate rules on separate surfaces, not one
   rule narrowed at closure.

2. **Slice 3, security finding L1 — the role summary's read scope.** `GET
   /api/v1/assets/role-summary` counts a group membership only when the
   caller can read the group itself. For a location- or organization-scoped
   caller that means groups at the caller's readable locations, through the
   existing `scopeFromSource`.

3. **Slice 3 — inactive assets are excluded from the role summary.** An
   asset with `bms.assets.active = false` is not counted under any role.

4. **Slice 3 — a null Key Parameters reading.** A gauge with no fresh
   sample shows an em dash with "Offline" or "No data", never a dial resting
   at zero — zero is a value, and reads as one. `RadialGaugeWidget` is
   unchanged; the null state is composed by the page around it.

5. **Accepted without a new row.** The class strip opens a second
   `/ws/alarms` socket on `/cr-overview`, beside the rail's own — a
   duplicate subscription, not a correctness fault, left as found (LOW).
   Commit `3038698d` added four point keys (`voltage_l1_v`, `kvar`,
   `frequency_hz`, `kwh_today`) to the overview's `pointValue` so the List
   view agrees with `/cr-sld`; this also changes what the *Rule Warnings*
   and *SLD Status* tiles, `MiniSld`, and the live-critical subtitle count
   for rules on those keys, since they already read the same `pointValue`
   map.

6. **Implementation note, not a ruling.** The role-summary query, planned
   with a bound `interval` parameter, made TimescaleDB plan every
   `point_values` chunk (520–1900 ms); a literal built from the same
   positive-integer-checked constant through `sql.raw` plans in 42–100 ms.
   Recorded here because the next window-bound query over this table will
   want the fact.

7. **`worstSeverity` carries `tone`.** The role-summary read returns
   `worstSeverity { code, label, tone, rank } | null`, one field more than
   decision 6 named — added so the strip can colour a role without a second
   lookup.
