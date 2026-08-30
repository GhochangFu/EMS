# ADR 0048 — Builder parity with the Nexus mock: a metric catalog beside point bindings, a `table` widget type, and aggregation on the tile

## Status

**Accepted** — 2026-08-30, by the repository owner, at the `F3.35` §10 gate and
**before any implementation code**.

Seven decisions were put one at a time, each with alternatives and a
recommendation. All seven were ruled as recommended. Three of them changed what
the draft had assumed, and each is recorded below with the fact that moved it
rather than with the preference.

This ADR **creates `F3.35`**. It does not amend [ADR 0047](0047-configurable-dashboards.md):
0047 froze a widget *vocabulary* and a *binding model*, and this record adds a
second binding kind beside the first rather than reopening either. Where the two
touch, 0047 is cited by decision number and its reasoning is applied, not
restated.

`F3.35` enters the board `🟡` on this acceptance. Never `🔵` — `docs/BACKLOG.md`
uses `🟡` for ADR/planned and no row in this repository has ever been marked
`🔵`.

## Context

`docs/ion-exchange-nexus-dashboard-2026-08-29.html` is a three-sheet client
mock, drawn in the platform's own shell, that Ion Exchange sees at the
workshop. **The owner ruled it into the repository on 2026-08-30, as a reference
point**, and it is committed with this ADR. It is the first client deck tracked
under `docs/`; the two mockups already tracked (`ESKOM_SMOC.html`,
`TRINETRA.html`) sit at the root and are *product* UX reference, where this one
is a dated client deliverable — so it keeps its date in the filename and stays
in `docs/`, and the root convention is left alone. Every claim below still
quotes the mock rather than merely citing it, which is how the claims were
written before the ruling and is worth keeping: a reader should not have to open
a 92 KB deck to check a sentence. Sheet 01 is an integrated operations overview. Sheet 02 states the
design claim this ADR exists to keep: *"Sheet 01 is not a bespoke screen; it is
one composition of a widget canvas."* Sheet 03 marks each region **NOW**,
**+1M** or **+3M** against the delivery view, and lists what the tile editor
gives at +1M: *"KPI cards, gauges, tank levels, trends, tables and comparison
charts."*

`F3.1` closed on 2026-08-30 (PR [#215](https://github.com/GhochangFu/EMS/pull/215)).
The tile editor Sheet 03 promises **is** `F3.1d`, and it is built. Measuring the
mock against it produced two commitments the branch does not keep and one
structural gap:

1. **Five of Sheet 03's six are shipped.** `value_tile`, `radial_gauge`,
   `tank_level`, `chart`/line and `chart`/bar all exist. **`table` does not.**
2. **Period-over-period comparison** — Sheet 03 says it *"lands with the tile
   editor at +1M"*. `valueTileConfigSchema` carries no delta field.
3. **Half of Sheet 01's numbers are not telemetry points at all.** Total Active
   Alarms is an alarm row count; Open Work Orders is a work-order row count;
   Asset Health is a roll-up formula; Operational Efficiency is a composite the
   client has not yet defined. Every widget today binds
   `bms.asset_points` through `bms.dashboard_widget_points`, and
   `apps/web/src/hooks/use-dashboard-telemetry.ts` has one data path: point ref
   → recent readings + live socket.

**The third is the load-bearing one, and it is why more widget types would not
have been enough.** A `donut` and a `table` would still have had nothing to
read.

### What already exists, and is easy to miss

- **The rollup views are built and are exact at their right edge.** ADR 0023
  (`F4.1`, migration `0027`) created `telemetry.point_values_{1m,5m,1h,1d}` with
  `sum_value`, `sample_count`, `min_value` and `max_value` — and, deliberately,
  **no `avg_value`**, because `avg` does not compose. All four set
  `timescaledb.materialized_only = false`. `apps/api/src/telemetry/point-aggregates.ts`
  is the single read seam, with `levelForRange` choosing the level.
  So Energy Today, Water Today, Peak, Average and *vs yesterday* are `sum`,
  `max` and `sum ÷ count` over relations that already hold the data.
- **There is no endpoint that asks them an arbitrary question.**
  `GET /telemetry/points/:pointRef/recent` returns raw readings.
  The four aggregate reads on `@Controller("dashboard")` — `load-trend`,
  `energy/summary`, `energy/source-mix`, `energy/top-consumers` — are fixed
  shapes for the fixed control-room pages. This ADR's decision 3 was drafted as
  "a config field, no new API" and that was **wrong**; the correction is
  recorded in the decision rather than smoothed over.
- **Derived points exist and are a genuine escape hatch.** `asset_points.kind`
  is `measured | derived` with a formula (ADR 0036/0037), computed by
  `apps/api/src/calc/`. A derived point is a point, so a client-supplied formula
  becomes an ordinary `value_tile` with no new machinery.
- **The calc engine cannot aggregate over time.** `CalcDefinition` carries
  `maxInputAgeSeconds` and references point *keys*: it computes over current
  samples. This closed one option below on a fact rather than a preference.

### What is already assigned elsewhere and is not reopened

- **`F3.28`** owns parity with the reference layout on the **fixed** page — the
  alarms rail, the status legend, the per-class health strip, the KPI
  period-delta as `/cr-overview` renders it. Decision 7 draws the line.
- **`F3.32`** owns the plant/network mimic builder. Sheet 01's *System Overview*
  is `F3.32`, and the mock marks it `+3M` itself.
- **`F3.2`** owns instantiating a template dashboard into `bms.dashboard_widgets`.
  Nothing here touches it.
- **The §5 dark canvas** stays an open owner decision. `F3.35` ships in the
  existing light palette, exactly as `F3.1` did.

## Decision

### 1. Non-point data arrives through a **named metric catalog**, not through synthetic points and not through self-sourcing widgets

A widget may bind a **catalog entry** by name — `alarms.active.count`,
`workorders.open.count`, `assets.health.score` — in addition to binding a point.
The builder shows the catalog as a picker of labelled entries, the way it
already shows a point picker.

**Ruled as recommended.** The alternatives and why they lost:

- **Self-sourcing widget types** (`alarm_table`, `work_order_table`,
  `asset_health`, each fetching its own data) is faster per card and breaks
  Sheet 02's claim: every new card becomes a release, and an administrator can
  compose nothing new. Sheet 02 tells the client *"an administrator with no
  programming skill composes these"*, and that sentence is a product property,
  not marketing.
- **Synthetic points** — writing an alarm count into `telemetry.point_values`
  every minute — was closed on two facts. The calc engine computes over current
  samples, not windows, so it cannot produce them; and ADR 0023's own header
  carries a standing obligation that **any `DELETE` from `point_values` must be
  followed by four `refresh_continuous_aggregate` calls**, finest first. Putting
  operational counts under that obligation is a cost with no benefit.

**The catalog is closed, by ADR 0047 decision 2's own test.** §4.8 as ADR 0032
rewrote it asks whether the behaviour can be carried as data. A widget type's
behaviour is a React component; **a catalog entry's behaviour is a SQL query**,
and no column holds one either. An entry declared by an `INSERT` would satisfy
every foreign key and then return nothing, in front of an operator, with a
green console. It is `F4.43` through the same door decision 2 already closed.

**What bounds the catalog, and keeps it small.** Derived points already let an
administrator declare a new *scalar* by formula. The catalog therefore carries
only what a point cannot be: **row counts over operational tables, and roll-ups
across assets**. A number expressible as a formula over points is a derived
point and must not become a catalog entry.

### 2. The catalog carries **datasets beside metrics** — one vocabulary, two shapes

A **metric** resolves to one number. A **dataset** resolves to rows and a
column list. A `value_tile` binds a metric; a `table` binds a dataset.

**Ruled as recommended, and it partly re-decides decision 1.** The alternatives:

- **A self-sourcing `table`** whose config names its dataset would have split
  the vocabulary in the worst place: the alarm *count* would come from the
  catalog and the alarm *table* from a widget config, and the two could drift
  about what "active" means while both looked right. One declared source for
  both is the point.
- **Datasets only, with a count as a dataset's row count**, is the smallest
  vocabulary and provably consistent, but `assets.health.score` and operational
  efficiency are not row counts of anything, so a scalar path is needed anyway —
  and every tile would fetch a row set to show one number.

**Consequence the builder must carry:** a table widget needs a **column picker**
as well as a source picker, because a dataset declares more columns than a
six-row card should show.

### 3. Point aggregation is a **widget config field plus one new read endpoint**

`valueTileConfigSchema` and `chartConfigSchema` gain an aggregate function, a
window, and — for the tile — an optional compare window that produces the
*vs yesterday* delta. The point binding is unchanged.

**One new endpoint on `@Controller("telemetry")`** reads `point-aggregates.ts`
for an arbitrary point, window and function. It is the first general aggregate
read in this API; the four existing ones are fixed shapes.

**The draft said "config field, no new API" and that was wrong** — the rollup
*views* exist, but nothing asks them an arbitrary question. The correction is
recorded because the error was in the direction that makes work look cheaper
than it is, which is the direction that damages a delivery date.

**Why not fold aggregation into the catalog** (decision 1's mechanism, one list
for every number): it would make Stage A below depend on the catalog, so nothing
would ship until the largest piece did — the opposite of the sequencing decision
6 requires. Each catalog entry would also have to be parameterized by point,
turning a name into a small query builder.

**The cost accepted with this ruling:** the builder now has **two ways to get a
number** — a point with a function, and a named metric — and an author must
learn which. Decision 2's single picker is what keeps that from becoming two
unrelated screens.

### 4. A catalog binding lives in a **fourth table**, `bms.dashboard_widget_sources`

Tenant-scoped from its creating migration per ADR 0043/0045, holding
`widget_id`, the catalog key, its parameters, and a `sort_order`.
`bms.dashboard_widget_points` is **untouched**.

**Ruled as recommended.** ADR 0047 decision 3 made `point_id` a real foreign key
with `ON DELETE CASCADE` so that retiring a sensor leaves a widget with
*countable* zero bindings rather than a stale id inside `jsonb`. The
alternatives both erode that:

- **Widening the existing table** — `point_id` nullable plus a `catalog_key`
  column and a `CHECK` that exactly one is set — gives one join, and makes a
  `NULL` `point_id` mean either "a catalog binding" or "a bug", with the `CHECK`
  the only thing telling them apart.
- **The key inside `config` jsonb** needs no migration and puts a binding back
  in `jsonb`, which is precisely what decision 3 rejected. Nothing could then
  report which dashboards use a retired catalog entry without scanning JSON —
  ADR 0019's orphan-check problem, re-created deliberately.

**A catalog key is a foreign key to nothing**, because the catalog is code
(decision 1). That is a real difference from a point binding, and a separate
table says so instead of hiding it behind a nullable column.

### 5. `table` is the fifth `widgetType`, and it is a release

`widgetTypeSchema` gains `"table"`; migration `0051` widens
`dashboard_widgets_widget_type_check`
(**that number is wrong — see [Errata 1](#errata-1--the-migration-number-was-taken-2026-08-30)**); `WIDGET_POINT_CARDINALITY` gains a fifth
key, which its `Record` type forces at compile time; `widget-catalog.ts` gains
its entry.

**Named as a release rather than absorbed**, on ADR 0047 decision 2's terms: a
new *kind* is always a release, and the generic `chart` exists to keep
chart-shaped asks out of that path. A table is not chart-shaped.

### 6. `F3.35` ships in three stages, and Stage A does not depend on the catalog

| Stage | Delivers | Depends on |
|---|---|---|
| **A** | Aggregation config + the new endpoint; the vs-yesterday delta; chart footer stats; the tile's icon, sub-line and tone — `KpiTile` already accepts all three props and `ValueTileWidget` passes none of them | Nothing in this ADR |
| **B** | The `table` widget type | Stage C's dataset half, for its rows |
| **C** | The catalog — metrics and datasets, the read API, `bms.dashboard_widget_sources`, the picker | Stage A only for the builder's shape |

**All three must be live for the client workshop**, ruled by the owner. Stage A
is independent by construction so it can be demonstrated first if the date
tightens.

### 7. What `F3.35` does **not** cover

- **Sheet 01's Alarm Details and Alarm Action / Workflow cards stay pages**, not
  widgets. Both run live today. A five-step stepper with assignment and an SLA
  clock is not a widget configuration a non-programmer fills in, and making it
  one would defeat the reason Sheet 02's claim is worth keeping. **This is a
  client-facing wording change**: eight of Sheet 01's ten regions become
  widgets, and the deck must say the other two are linked pages.
- **`F3.28`** keeps the fixed page. `F3.35` owns the config field and the
  renderer; `F3.28` consumes them on `/cr-overview`. Where the same delta
  appears twice, `F3.35` builds it and `F3.28` uses it.
- **`F3.32`** keeps the process diagram.
- **The two metrics the client still owes.** `assets.health.score` needs the
  roll-up formula from feature-sheet row 12, and operational efficiency needs a
  definition. **Stage C builds the catalog machinery without them and cannot
  compute those two entries.** Sheet 03 already names both as client inputs. If
  the workshop needs the real numbers, that email is on the critical path — the
  same shape that blocks `E5.1`.
- **The §5 dark canvas** stays the owner's, untouched.

## Dependencies

**None.** No npm package is added, so §9.4 opens no gate.

Stated rather than left implied, because the natural reading of "a table widget"
is a data-grid library. `F3.1d` answered the equivalent question for the canvas
by not needing one — `dashboard-canvas.tsx` runs on Pointer Events — and a
six-row card with a column picker is a `<table>`. **If Stage B concludes it
needs a grid library, that is a §9.4 gate and its own ADR**, on the ADR 0042
precedent, and ADR 0042 Amendment 1 is the reason to check the Node floor before
pinning anything.

## Consequences

- **Two mechanisms produce a number**, accepted knowingly in decision 3. The
  single picker is the mitigation; if authors still confuse them, the fix is
  presentation, not a third mechanism.
- **The catalog is a new closed vocabulary**, so it inherits decision 1's rule:
  adding an entry is a code change. Anything expressible as a formula over
  points must be a **derived point** instead, and a reviewer should push back on
  a catalog entry that could have been one.
- **`bms.dashboard_widget_sources` is the fourth table on this feature.** The
  viewer gains a second read path and a second join. `use-dashboard-telemetry.ts`
  gains a branch beside its point path; the socket stays one per page.
- **Migration `0051` widens a `CHECK` and creates a table** (**the number is
  wrong — see [Errata 1](#errata-1--the-migration-number-was-taken-2026-08-30)**). Forward-only, and
  tenant-scoped in the same migration that creates it — ADR 0043/0045, and
  `E7.1b`'s `0046`/`0047` are the recorded cost of retrofitting.
- **The new aggregate endpoint is a general read over telemetry** and needs the
  same organization scoping the point picker proved in `F3.1d`'s browser pass,
  where the picker listed only the ten locations of the dashboard's own
  organization. A general endpoint is a wider surface than a fixed one; it is
  the security-relevant part of this ADR.
- **`docs/BACKLOG.md` gains `F3.35`** with the three stages, `Depends: F3.1`, and
  the two client inputs recorded against Stage C.
- **`AGENTS.md` and `docs/roadmap.md` follow-ups belong to a separate
  `chore(agents):` PR** (§9.10), after `F3.35` closes — never to this record and
  never to the feature branch. Targets: the status line, the §2 *Configurable
  dashboards* row (which this ADR gives a second binding kind and a fifth widget
  type), §4.8's closed-vocabulary worked example (the catalog is a second one
  reached through ADR 0032's test), and a roadmap section.
  **Per §10.1 this is ADR 0048 alone** — do not batch its sweep.
- **This ADR's follow-up list was built by grep, not from the draft**, on the
  practice ADR 0047 recorded after its own first sweep missed a target the ADR
  itself named. Run the searches again at sweep time rather than trusting this
  paragraph: `F3.35`, `0048`, `catalog`, `dashboard_widget_sources`, `table`
  widget, across `AGENTS.md`, `docs/adr/`, `docs/roadmap.md` and
  `docs/BACKLOG.md`.
- **One correction is preserved rather than deleted.** Decision 3's draft
  claimed no new API was needed. It was checked against
  `telemetry.controller.ts` and found wrong. The check that caught it — read the
  controller, do not infer the endpoint from the existence of the view — is the
  reusable part.

## Errata 1 — the migration number was taken (2026-08-30)

Decision 5 and the Consequences bullet both name migration `0051` for Stage B's
`CHECK` widening. **`0051` was taken by `F3.37` (`bms.asset_roles`) on
2026-08-30, the same day this ADR was accepted.** `E1.3` then took `0052` and
`0053`. The next free number is `0054`, and Stage B must read it from
`packages/db/drizzle/` when the migration is written rather than from this
record.

The original sentences are corrected by pointer rather than rewritten: what was
decided, and on what belief, is part of the record.

### Why it happened, which is the reusable part

Reserving a migration number in prose does not reserve it. This ADR was drafted
and accepted while `F3.37` was in flight against the same directory; nothing
arbitrates between an ADR that names a number and a branch that takes one, and
the loser is whichever lands second — here, the ADR, which cannot fail a test.

**ADR 0050 acted on this before its own migration existed.** Its Dependencies
section says: *"The migration number is taken from `packages/db/drizzle/` when
the migration is written, and is deliberately not recorded here. ADR 0048
decision 5 named a number in prose, `F3.37` took it the same day, and that
erratum is still owed."* That is the practice this errata ratifies — **an ADR
names the migration's job, never its number.**

### What is not corrected here

Everything else in decision 5 stands: `table` is the fifth `widgetType`, it is a
release rather than an absorbed change, and the `CHECK` widening plus the
`WIDGET_POINT_CARDINALITY` key are still what Stage B needs.

**The `AGENTS.md` / `docs/roadmap.md` sweep this ADR schedules is still not
due.** Its Consequences gate it on *"after `F3.35` closes"*, and `F3.35` is
`🟡`: Stage A shipped as PR #226, and Stages B and C are unbuilt. The sweep's
named targets — §2 gaining a second binding kind and a fifth widget type,
§4.8's catalog worked example — describe capability `main` does not have, so
writing them now would make the rulebook claim a `table` widget and a metric
catalog that do not exist. Checked on 2026-08-30 by re-running the searches this
ADR's Consequences prescribe: neither `AGENTS.md` nor `docs/roadmap.md` mentions
`F3.35`, ADR 0048 or `dashboard_widget_sources` at all, so the sweep is an
addition rather than a softening and nothing false is sitting there meanwhile.
