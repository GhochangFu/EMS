# ADR 0050 — Asset health score: the in-range counter, and where the formula is not

## Status

Accepted — 2026-08-30, by the repository owner, at the
`build-operating-model.md` step 2 gate for `E1.3`.

## Context

`E1.3` (asset health score, asset → plant → enterprise) stopped being a
research question on 2026-08-22, when the client supplied the formula
(sheet row 12):

> tag-level goodness = data points in safe range / total data points, rolled up
> with user-configurable weights, topped by bad-actor identification.

The same answer confirms **telemetry-only at go-live** and moves the SOW §4.3
five-input score to a later phase. `E1.3`'s backlog row also pins the
presentation: a donut over five named bands — **Excellent / Good / Fair / Poor
/ Critical** — with count *and* share against a total asset count. The band
names are the client's, not ours.

Three facts about the codebase decide most of the shape, and each was measured
on the running stack rather than assumed.

**1. The rollup relations cannot express the numerator.** ADR 0023's four
continuous aggregates store `sum_value`, `sample_count`, `min_value` and
`max_value` — deliberately no `avg_value`, because `avg` does not compose.
There is no conditional count anywhere. `min`/`max` can say whether a bucket
was *entirely* inside a range; they cannot say how many of its samples were.

**2. Reading raw at request time is not viable for the surface `E1.3`
specifies.** Measured on `telemetry.point_values`: the median gap between
samples is **0.509 s**, and one tag produced 10,913 rows in 3.7 hours. That is
~172,800 samples per tag per day. The client's reference enterprise is 265
assets; at ten tags each, an enterprise donut over a 24-hour window would scan
hundreds of millions of rows for one landing page. Raw retention is 730 days
(`0028_compression_retention.sql`), so *availability* is never the blocker —
cost on the read path is.

**3. There is no "safe range" anywhere in the schema.** It is not a column on
`bms.asset_points`; that table carries no bound of any kind. What exists is
`bms.automation_rules`, whose threshold rows carry `asset_id`, `point_key`,
`operator`, `threshold_value`, `severity`, `enabled` and `lifecycle_status`.
Measured: **289 threshold rules, every one `enabled` and `published`, every one
bound to a concrete `(asset_id, point_key)`**, severity split 110 `critical` /
179 `warning`. The operator vocabulary in use is `eq · gt · gte · lt` — there
is **no `lte`, and no range concept at all**.

One further fact shaped decision 3 rather than being a consequence of it. The
local database currently holds 16 distinct `(asset_id, point_key)` pairs in
`telemetry.point_values_1h`, of which **15 are orphaned integration-test
residue on assets that no longer exist in `bms.assets`** (14 × `backup_min`,
one `CALCWRITE_C`). Exactly one — `CH-CRAC-102::kw` — is a real asset, and it
carries no threshold rule and no `bms.asset_points` catalog row. So the overlap
between "tags with telemetry" and "tags with a threshold rule" is currently
**zero**, and `E1.3` cannot be demonstrated end to end until that is fixed. That
is a fixture problem, not a health-score one, and it is named in *Consequences*
rather than solved here.

## Decision

**1. Aggregation is resolved outside the formula, and `bms-calc-v1` is not
amended.** ADR 0036's grammar stays frozen: scalar arithmetic over
`{pointKey}` refs with `min · max · abs · round · clamp`, no comparison, no
aggregate, no asset qualifier. The health read resolves the windowed inputs
itself and hands them to the existing pure `evaluate()` as a plain
`ReadonlyMap<string, number>`, exactly as ADR 0037's *Not in this ADR* already
specifies for KPI evaluation:

> KPI evaluation is a call into the same pure `evaluate()` from whatever
> renders the KPI

So the organization authors a **scalar expression over named inputs** —
`{IN_RANGE_COUNT} / {TOTAL_COUNT}` — and the window comes from the dashboard or
report context, not from the formula text. `evaluate()` keeps its property of
knowing no clock and no database, which is what makes `F2.5`'s live preview
possible at all.

The two alternatives ADR 0037's Consequences named for `F2.8` were both
considered and both rejected **for this row**. Amending the grammar with
aggregates and a window notation would break `evaluate(ast, inputs)`, require a
set-selector concept that does not exist, and turn an expression language into
a query language; it is the right answer for `F2.8`, which genuinely needs
asset-qualified references, and it should be driven by `F2.8`. A site-level
asset carrying totals as measured points needs `F2.10`'s parent tier, which
re-opens ADR 0008 and touches every scoped authorization check, and it would
leave the aggregation logic as code rather than configuration anyway.

**2. "In safe range" means no enabled, published threshold rule fires for that
sample.** There is no range concept to read, so the predicate is derived from
the rules that already exist:

```
in_range(sample) ⇔ ¬∃ r ∈ automation_rules :
    r.rule_type = 'threshold'
  ∧ r.enabled = true
  ∧ r.lifecycle_status = 'published'
  ∧ r.asset_id = sample.asset_id
  ∧ r.point_key = sample.point_key
  ∧ fires(r.operator, sample.value, r.threshold_value)
```

This reuses data an operator already maintains, needs no new authoring surface,
and handles a two-sided range naturally as two rules. It also matches operator
intuition: a healthy point is one raising no alarms.

**Severity is deliberately not filtered.** A `warning` rule makes a sample
out-of-range exactly as a `critical` one does. Weighting goodness by severity
is a second, independent axis, and the client's sentence puts configurable
weights on the *roll-up*, not inside the tag ratio. It is named in *Not in this
ADR* rather than half-built.

**"Safe range" is a misnomer for what is computed, and that is recorded here so
a later reader does not model it as `[low, high]`.** The vocabulary includes
`eq`, so a rule can carve a single value out of the middle of an otherwise
acceptable band. The in-range set is therefore not guaranteed contiguous. The
client's phrase is kept in prose because it is the client's; the implementation
name is `in_range`, not `safe_range`.

**3. A tag with no threshold rule is excluded from the roll-up, not scored
1.0.** With no rule, every sample is trivially in range and the tag would
contribute a perfect score. That inflates the donut with tags nobody has
defined goodness for, and the inflation is invisible in the output. Measured
above: on the current fixtures this is the *majority* case, not an edge case.

The excluded count is **reported, not silently dropped** — the health response
carries `scoredTags` and `unscoredTags`, so "this asset has no rules" is
legible as itself rather than as a perfect score. This mirrors ADR 0037
decision 9: a skipped calculation is an absent value, never a wrong one.

**4. The counter is materialized by a scheduled roll-up job into its own
relation.** Not a column on a continuous aggregate, and not a flag written on
the telemetry write path.

A CAGG column was rejected because the predicate needs `bms.automation_rules`,
and ADR 0023's aggregates are **hierarchical** — `1m ← raw`, `5m ← 1m`,
`1h ← 5m`, `1d ← 1h` — so a join would have to survive TimescaleDB's
restrictions on both joined and stacked continuous aggregates. A write-path
flag was rejected because four separate services insert into
`telemetry.point_values` (`TelemetryWriteService`, `CalcWriteService`, ingest
and the simulator), and putting rule evaluation into all four couples telemetry
writes to the rule engine for one consumer's benefit.

The job writes a per-bucket count that **composes by `sum`**, exactly as
`sample_count` does, so the roll-up stays level-agnostic — which `F2.10`
requires, since the ladder may gain tiers. It reuses ADR 0037 decision 7's
self-scheduling `await` loop and the `sleep(ms, signal)` helper already in
`telemetry-notify.service.ts`, never `setInterval`, so a slow sweep delays the
next tick rather than overlapping it. No scheduling dependency is added.

A re-run over a date range re-evaluates against the **current** rule set, so
editing a threshold and re-scoring history is a supported operation rather than
an impossibility. That is the main advantage over a CAGG, and it is why the
"materialization freezes the threshold" objection does not bind here.

**5. The score is a completed-bucket figure, and the asymmetry is stated rather
than discovered.** All four ADR 0023 aggregates run
`timescaledb.materialized_only = false`, so `F3.35`'s chart is exact to the
newest *partial* bucket. A plain relation written by a scheduled job has no
such live branch: the newest bucket is absent until the job runs. A donut and
the chart beside it will therefore disagree at the leading edge. The health
read reports the instant it is current to, so the difference reads as what it
is instead of as an arithmetic bug.

**6. The read reuses `F3.35`'s ladder. It does not declare a second one.**
`levelFor`, `windowBounds` and `bucketSeconds` come from
`apps/api/src/telemetry/point-aggregate-window.ts`, where `MAX_BUCKETS` is
already *derived* from the ladder table rather than declared beside it. Two
ladders would drift, and the first symptom would be a health score and a trend
chart covering different windows while both looked right.

**7. Weights and band cut-points are typed data in
`asset_templates.content.health`.** `E1.7` rejected that tier rather than
accepting it untyped, with the rule "each reopens as its consumer lands", and
three of the five have reopened this way already — `kpis` (`F2.3`, ADR 0036),
`alarms.philosophy` (`E2.1`, ADR 0034) and `dashboards` (`F3.1a`, ADR 0047).
`E1.3` is `health`'s consumer, so `health` reopens now, contracted by a Zod
schema in `packages/shared` per ADR 0030.

The five bands are **Excellent / Good / Fair / Poor / Critical**, the client's
names, stored as ordered cut-points rather than hardcoded. Per
`prefer-dynamic-vocabularies` and ADR 0031/0032's precedent, the band set is a
lookup, not an enum with a `CHECK`.

**8. The roll-up job reads rules per organization, as the tenant role.**
`telemetry.*` carries no Row Level Security, but `bms.automation_rules` does —
it is `bms.*` with `organization_id NOT NULL` under ADR 0043's policies. The
job therefore sweeps **one organization at a time** with that organization's
context set, using the tenant role, rather than reading every org's rules as an
owner or superuser under `FORCE ROW LEVEL SECURITY`. A cross-tenant read here
would be a containment hole in a background job that no request-scoped guard
covers.

**9. Standing obligation, in the class of ADR 0021 decision 6 and ADR 0027's
own.** Any `DELETE` from `telemetry.point_values` must be followed by a re-run
of the health roll-up over the affected range, finest level first, in addition
to the `refresh_continuous_aggregate()` calls `0027_continuous_aggregates.sql`
already requires. **No scheduled policy repairs it** — the job's own window
never reaches that far back. This is written here, and must be written into the
migration's header comment the way `0027` wrote its own, because the failure is
silent: a deleted raw row leaves a stale in-range count readable forever.

## Not in this ADR

- **No grammar change.** Decision 1. ADR 0036 stands unamended, and `F2.8`
  still needs its own answer on asset-qualified references or aggregates.
- **No severity weighting inside the tag ratio.** Decision 2. A second axis,
  and nobody has asked for it.
- **No bad-actor identification beyond ranking.** The client's phrase is
  satisfied by ordering assets on the score this ADR computes. Anomaly
  detection needs `E1.1` and is out of scope here.
- **No five-input SOW §4.3 score, and no ML.** Moved to a later phase by the
  client's own 2026-08-22 answer. It takes its own backlog row, which keeps the
  `E1.1` dependency that `E1.3` no longer carries.
- **No Operational Efficiency.** §B14 asked the client to define the numerator
  and the denominator and is unanswered. Decision 1's seam will carry it
  whatever the definition turns out to be; guessing it here would put a
  fabricated formula on an executive screen.
- **No new hierarchy tier.** `F2.10` owns campus/township and asset
  parent/child. Decision 4 keeps the roll-up level-agnostic so those tiers
  arrive as data.

## Dependencies

None. No `package.json` change in any workspace — decision 4 exists partly so
the scheduled half needs no scheduling library, following ADR 0037 decision 7.
§9.4 is not triggered.

One additive, forward-only migration creating the counter relation, plus the
`asset_templates.content.health` schema in `packages/shared` (no DDL — that
column is already `jsonb`). **The migration number is taken from
`packages/db/drizzle/` when the migration is written, and is deliberately not
recorded here.** ADR 0048 decision 5 named a number in prose, `F3.37` took it
the same day, and that erratum is still owed.

## Consequences

- **`E1.3` cannot be verified end to end on the current fixtures.** The overlap
  between tags with telemetry and tags with a published threshold rule is zero:
  15 of the 16 rollup tags are orphaned integration-test rows on deleted
  assets, and the one real pair (`CH-CRAC-102::kw`) has neither a rule nor a
  `bms.asset_points` row. A seeded asset carrying **both** telemetry and
  threshold rules is a prerequisite for `F4.6`-style verification, and it has
  no backlog row yet. This was found while drafting this ADR and is recorded so
  it is not rediscovered as a bug in the health score.
- **The donut's shape depends on decision 3, and the dependency is not
  recoverable later without re-scoring.** Excluding unruled tags rather than
  counting them perfect moves the 112 / 86 / 42 / 17 / 8 reference distribution.
  If the client's reference numbers were produced under the other reading, the
  two will not reconcile, and the ADR would need amending rather than the code
  being wrong.
- **Rule authoring becomes score authoring, whether or not anyone intends it.**
  Decision 2 makes every published threshold rule a term in the health score.
  An operator adding an advisory rule lowers scores across every asset that
  rule matches. That is defensible — an alarm *is* a statement about goodness —
  but it is a coupling that did not exist before, and it should be visible in
  the rule editor before `E1.3` ships.
- **`E1.7`'s `health` tier is now the fourth of five to reopen.** Only
  `optimisation` (`E1.6`) stays rejected.
- **The roll-up job is a second scheduled host in `apps/api`.** ADR 0037
  decision 7 built the first. They should share the loop shape, and a third
  would be the point at which extracting it stops being premature.
- **The counter relation inherits `0027`'s deletion hazard without inheriting
  its repair.** Decision 9. The continuous aggregates at least have refresh
  policies that re-cover recent windows; this relation has only the standing
  obligation.

## Amendment 1 — four counter relations, and the five rulings the step-3 plan gate settled (2026-08-30)

### Context

Decision 4 says the counter is materialized "into its own relation" — singular.
Decision 6 says the read reuses `F3.35`'s four-level ladder. Those two sentences
are not contradictory: one relation carrying a `level` discriminator column
satisfies both as written. They are *underdetermined*, and the step-3 plan for
`E1.3` could not write the migration without choosing.

Four other questions were underdetermined in the same way, and all five were put
to the repository owner at the plan gate on 2026-08-30 and ruled there. This
amendment records the rulings, because a migration header and a plan document
are both weaker records than an ADR: `CLAUDE.md` makes the ADR authoritative on
scope, and `E1.8` — the row that inherits this score — starts by reading this
file.

It also corrects one factual claim the plan made about grants, records two
schema facts the original had not checked, and extends decisions 5 and 9, whose
wording assumed a single relation.

### Decision

1. **Four relations, one per level:** `telemetry.point_in_range_1m`,
   `_5m`, `_1h`, `_1d`. Names mirror ADR 0023's `point_values_1m … _1d`
   deliberately, so the pairing is legible from the catalog alone. Each holds a
   per-bucket `in_range_count` and `sample_count`, and the coarser levels are
   derived from the finer by `sum`, exactly as decision 4 requires and in the
   same order ADR 0023's aggregates stack.

   Rejected: one relation with a `level` column. Three reasons, and the third is
   the load-bearing one. (a) The four-table form gets from the table name what a
   `level` column makes every read carry as a predicate, and a forgotten
   predicate silently sums four levels into one wrong ratio. (b) Decision 6
   forbids a second ladder; four relations keep a 1:1 with the four aggregates
   the ladder already names, so `levelFor()` maps to a relation without a
   translation table. (c) Retention and compression horizons differ per level in
   migration `0028` and would differ here too, and a single table cannot carry
   four horizons — the coarse levels are the ones worth keeping longest, and
   they are the smallest.

2. **The score is `0..1` on the wire, and the band cut-points are in the same
   unit.** Not `0..100`. A ratio of counts is natively `0..1`, the conversion
   belongs at the rendering edge where the `%` sign is added, and a mixed-unit
   API is how a cut-point of `0.9` and a score of `90` end up compared.

3. **Weights default to `1.0`; bands are required.** An
   `asset_templates.content.health` block that omits weights scores with every
   term weighted equally, because equal weighting is the only defensible default
   and refusing to score would make the tier's adoption a flag day. Bands have
   no such default — five cut-points cannot be guessed, and inventing them puts
   a fabricated "Excellent" on an executive screen.

   **An asset whose template carries no bands is scored numerically and reports
   `band: null`. It is counted, not dropped.** This is decision 3's rule applied
   one level up: an absent classification is reported as absent, never as a
   wrong one, and never by removing the asset from the denominator.

4. **The roll-up job ticks every 60 s and sweeps a 24-hour trailing window at
   `1m`, widening per level.** The tick matches ADR 0037 decision 7's existing
   loop, so the second scheduled host in `apps/api` behaves like the first. The
   trailing window is what makes the job self-healing: a missed tick, a restart
   or a slow sweep is repaired by the next pass rather than leaving a permanent
   hole, and 24 hours at `1m` is 1440 buckets per tag — the same order as
   `MAX_BUCKETS` already permits on a read.

   This does **not** repair a `DELETE` older than the window. Decision 9 stands
   and is the only thing that covers that case.

5. **`E1.3` closes with the donut.** The row's web half — the asset, plant and
   enterprise score surfaces — is in scope for `E1.3` rather than deferred to a
   follow-on row. The original ADR is silent on the boundary, which read as
   API-only to the plan; it is not.

6. **The migration brackets its `CREATE TABLE`s in `SET ROLE bms_owner` /
   `RESET ROLE`, and writes no explicit `GRANT`.** The plan reported that
   `0039`'s `GRANT … ON ALL TABLES IN SCHEMA telemetry` is point-in-time and
   would not reach a new table, and concluded that the migration must grant
   explicitly. The first half is true and the conclusion is wrong.
   `0041_bms_owner_and_force_rls` lines 112-119 set `ALTER DEFAULT PRIVILEGES
   FOR ROLE bms_owner` in **both** `bms` and `telemetry`, so the grant arrives
   automatically — but only for objects created *by that role*, and
   `pnpm db:migrate` connects as `DATABASE_URL_SUPERUSER` (`bms_app`). The
   bracket is what makes `bms_owner` the creator.

   A hand-written `GRANT` is not merely redundant: `0050` and `0051` both record
   in their headers that it would **hide a future breakage of the bracket**, and
   the failure it hides surfaces "one endpoint at a time" long after the
   migration. `bms_owner`, not `bms_rollup`: `bms_rollup` owns the ADR 0023
   aggregates because TimescaleDB requires the aggregate's owner to refresh it,
   and a plain table imposes no such requirement — `0045` exists precisely
   because `bms_rollup`-owned objects then need extra grants to be readable.

7. **A threshold rule with a NULL `operator` or a NULL `threshold_value` is
   skipped and counted — never treated as not firing.** Both columns are
   nullable in `packages/db/src/schema/bms-schema.ts` (`operator` and
   `thresholdValue`, neither `.notNull()`), the same shape and for the same
   reason as the `severity` column `F4.46` established. Treating an
   unevaluatable rule as "did not fire" makes the sample in-range and inflates
   the score, which is decision 3's defect reached by another road. The skipped
   count is carried on the row so the inflation cannot be silent.

8. **Decision 9 extends to all four relations: a re-run walks them finest
   first,** `1m → 5m → 1h → 1d`, in addition to `0027`'s
   `refresh_continuous_aggregate()` calls. Deriving a coarse level from a stale
   fine one propagates the error upward, so order is not optional. This must be
   in the migration header, as decision 9 already requires.

9. **Decision 5 extends the same way: there are four currency instants, not
   one, and the read reports the instant for the level it actually read.** A
   `1d` figure current to 03:00 beside a `1m` figure current to 03:59 is
   correct, and looks like an arithmetic bug unless the response says which is
   which.

10. **The four relations are plain tables, not hypertables, and the trigger for
    revisiting that is stated rather than left to judgement.** ADR 0024's
    compression and retention guards name a fixed list of relations in `0028`
    and do not reach these. Converting is cheap and reversible; converting
    early adds four chunking decisions to a row that has no production volume
    yet. **Revisit when `telemetry.point_in_range_1m` exceeds 50 million rows,
    or when any level's retention becomes a question anyone asks.** Until then
    the tables grow unbounded, which is a known and accepted state, not an
    oversight.

### Consequences

- **Decision 1 makes the migration wider and the read narrower.** Four
  `CREATE TABLE`s instead of one, and a level-to-relation map that must stay in
  step with `point-aggregate-window.ts`. The map is the thing that can drift;
  it belongs beside `levelFor`, not beside the SQL.
- **`band: null` is a fourth absent-value case**, after the original decision
  3's `unscoredTags`, this amendment's decision 7 skipped rules, and ADR 0037
  decision 9's skipped calculations. That is a pattern worth naming rather than
  four coincidences, and the contract in
  `packages/shared/src/contracts/health.ts` should keep each one
  distinguishable rather than collapsing all four to one `null`.
- **Decision 6 corrects a claim that was already acted on once.** The plan's
  grant finding would have produced a migration that passes review, works in
  every environment, and disarms the guard that catches the real failure. It is
  recorded here rather than only fixed, because the next row creating a table
  will read the plan pattern, not the migration.
- **Decision 10 accepts unbounded growth.** At the measured 0.509 s sample gap a
  single ruled tag produces 1440 `1m` rows per day. The current fixtures have
  no ruled tag carrying telemetry at all, so the accepted state is presently
  zero rows — which is exactly the condition under which an unbounded table is
  easy to leave unnoticed. The trigger in decision 10 is the guard, and it is a
  number so that it can be checked.
- **`E1.3` closing with the donut (decision 5) brings the browser layer into
  its verification**, which the API-only reading would have made N/A. AGENTS.md
  §4.6 asks that skipped layers be named; this one is not skipped.

## Amendment 2 — bucket coverage on the wire, and why the read is not clamped to the sweep's trailing window (2026-08-31)

### Context

`F4.72` (PR #228, merged 2026-08-31) recorded two open questions in its *Known
and recorded, not fixed here* section, and both were put to the repository owner
on 2026-08-31 and ruled there. This amendment records the rulings and the
measurements that changed one of them.

**The first question is real and this amendment answers it.** Amendment 1
decision 9 puts `computedAt` on the wire as the currency of the level actually
read, and it is the *newest* instant across the rows read. A window whose middle
is missing therefore reports the same `computedAt` as a window that is complete.
The response cannot disclose a hole, and a donut drawn from half a window looks
exactly like a donut drawn from all of it.

**The second question was framed on a premise that does not hold.** The PR
recorded that "a 48-hour read at `1m` covers a window the roll-up only fills for
24 hours", and asked whether to clamp the read or widen the sweep. Three
measured facts retire the framing:

1. **The counter rows persist.** Amendment 1 decision 10 makes all four
   relations plain tables, and `0052_health_in_range_counters.sql` adds no
   retention policy, no `drop_chunks` and no hypertable. Nothing deletes a
   counter row.
2. **`TRAILING_WINDOW_MS` bounds re-derivation, not coverage.**
   `health-rollup.service.ts` re-derives 24 h at `1m` and `5m`, 48 h at `1h` and
   7 d at `1d` on every 60-second tick. Buckets written by earlier ticks stay
   written. On a system whose sweep has run for more than 48 hours, a 48-hour
   read at `1m` is fully covered.
3. **A clamp does not generalize past `1m`.** A rule that refuses a window
   longer than the level's trailing window also refuses a 30-day read at `1h`
   (48 h trailing) and a 365-day read at `1d` (7 d trailing). No level survives
   it. The rule appeared workable only because it was posed at `1m`.

What remains true is narrower, and it is the same shortfall the first question
names: coverage is short for the first 24 hours after the feature starts, and
after an outage longer than the level's trailing window, which no later tick
repairs. Both are exactly what decision 1 below discloses.

### Decision

1. **The response carries `coveredBuckets` and `expectedBuckets`, and a
   renderer that shows a score over an incompletely covered window must say
   so.** Both are non-negative integers on the shared `windowFields` block in
   `packages/shared/src/contracts/health.ts`, so the asset response and the
   summary response carry them alike.

   - `expectedBuckets` is the number of buckets the requested window contains at
     the level actually read. It is `expectedBucketCount(windowMinutes, level)`
     from `apps/api/src/telemetry/point-aggregate-window.ts` — the function
     `F3.35` already derived for this arithmetic, not a second copy of it.
   - `coveredBuckets` is the number of **distinct bucket instants inside the
     window for which the scope read at least one counter row**. It is computed
     from the rows the read already holds, and adds no query.

   **Two integers, not a ratio.** This is the contract's existing rule, applied
   again: `healthTagScoreSchema` carries `inRangeCount` and `sampleCount` beside
   `score` because 1.0 over three samples and 1.0 over three thousand are
   different facts. `1439 / 1440` and `1 / 1` are different facts in the same
   way, and only the pair distinguishes them.

   **Coverage is measured per bucket across the scope, not per tag.** One sweep
   pass writes every ruled tag in a bucket, so a bucket with no row anywhere in
   scope is a pass that did not happen. A gap in one tag's own telemetry is a
   different fact and `sampleCount` already carries it — putting per-tag
   coverage here would report an idle sensor as a roll-up outage.

   **It is not a fifth absence.** The four absences the contract's docblock
   enumerates each say that a *value* is missing. Coverage says the *window* is
   incompletely backed while every value in it is sound. A reader that collapses
   the two reports "no data" for a score that is correct over the buckets it
   has.

   **`coveredBuckets: 0` and `computedAt: null` must agree.** A scope with no
   rolled-up bucket has no instant and no coverage, and a response carrying one
   without the other is a defect, not a state.

   **What coverage cannot say.** It measures the counter relations, so it cannot
   separate a sweep outage from an enterprise-wide telemetry outage — in both,
   the bucket is absent. That is acceptable because the reader's decision is the
   same in both cases: do not trust this figure as a full-window figure. It is
   stated here so that a later reader does not read a stronger claim into the
   number.

2. **The read is not clamped to the sweep's trailing window, and the sweep's
   trailing window is not widened.** `resolveWindow` in
   `asset-health.service.ts` keeps calling `F3.35`'s `levelFor` unchanged, and
   the read must not import `TRAILING_WINDOW_MS`.

   Rejected, with the reasons from *Context*: a clamp trades a permanent loss of
   resolution on every 25-to-48 hour read against a condition that is transient
   on a running system, and it collapses at `1h` and `1d`. Widening the `1m`
   sweep to 48 h doubles the finest level's work on a 60-second tick, shortens
   the first-day gap only, and still does not repair an outage older than the
   window.

   Also rejected for a standing reason: editing the ladder in
   `point-aggregate-window.ts` would change merged `F3.35` behaviour and move
   the derived `MAX_BUCKETS`, and ADR 0050 decision 6 exists so that there is
   exactly one ladder. A second window rule in `asset-health/` would be that
   second ladder under another name.

3. **The gap the sweep never repairs is disclosed, not closed.** Amendment 1
   decision 4 already records that a trailing window does not repair a deletion
   older than itself, and that ADR 0050 decision 9 and Amendment 1 decision 8
   are the only cover. Decision 1 adds no repair. It makes the same class of
   hole visible on the wire instead of silent, which is what the original
   question asked for.

### Consequences

- **Two integers arrive on both responses, and `.strict()` is restated at both
  levels.** The round-trip fixtures must carry them, on the `F3.35` pattern that
  asserts the fixtures cover every field the contract declares — otherwise a
  field can be added without a fixture.
- **The web layer gains a partial-window state.** It is distinct from the empty
  state: `coveredBuckets: 0` is "nothing to show", and `0 < coveredBuckets <
  expectedBuckets` is "a real score over less than the window you asked for".
  Rendering the second as the first hides a score that is correct.
- **A freshly seeded or freshly started deployment reports partial for its first
  24 hours.** That is now visible rather than hidden, and it is the honest
  reading of a system that has 24 hours of counters and was asked for 48.
- **`E1.8` inherits both fields** together with the score it already inherits,
  and inherits the limit in decision 1 with them.
- **No migration.** The counters and their columns are unchanged; this is
  contract and read-path surface only.

## Amendment 3 — the read aligns to the sweep's bucket boundary, because a whole window was unreachable by one (2026-08-31)

### Context

This is an **erratum on Amendment 2 decision 1**, found by the `F4.72`
correctness review before that row merged, and ruled by the repository owner on
2026-08-31.

Amendment 2 decision 1 defines `expectedBuckets` as
`expectedBucketCount(windowMinutes, level)` over the **requested** window. The
requested window ends at `now`. The sweep's does not.

`alignedWindow` in `health-rollup.service.ts` ends at
`floor(now / width) * width`, and its docblock states the rule this ADR's
decision 5 gave it: *"`to` is the start of the newest COMPLETE bucket, not
`now`"* — rolling up a bucket that is still filling would write a count over a
partial sample set, which the next tick would overwrite with a larger one. The
newest bucket the sweep can ever write is therefore one width older than
`floor(now / width) * width`.

`resolveWindow` did not align. It took `to = now`, and `readCounters` admits
`bucket < to`, so the read window always contained the **in-flight** bucket —
the one the writer is forbidden to write. A window of `N` buckets could
therefore cover at most `N - 1` of them, at **every** rung.

The consequences were not cosmetic:

1. `coveredBuckets === expectedBuckets` was unreachable, so the `complete`
   state in `healthWindowCoverage` was dead code and the partial-window banner
   was **permanently on** for every healthy deployment. A warning that never
   turns off carries no information — the same defect `F4.74` fixed one
   component over, arriving by the opposite route.
2. It contradicted this ADR's own Amendment 2 Consequences, which name a
   deployment's *first 24 hours* and an outage longer than a trailing window as
   the two real cases. A permanent off-by-one is a third, and it was not
   disclosed anywhere.
3. The jsdom negative control could not see it. It asserted a whole window from
   a hand-written `1 / 1` fixture — a state the server arithmetic forbade — so
   the test whose stated purpose was *"without this, a banner rendered
   unconditionally would make every healthy read look degraded"* was green while
   exactly that shipped.

### Decision

1. **`resolveWindow` in `asset-health.service.ts` aligns its `to` down to the
   bucket boundary of the level actually read**, and derives `from` from that
   aligned instant. `windowFrom`, `windowTo`, `coveredBuckets` and
   `expectedBuckets` then all describe one window, and that window is the one
   the sweep is able to fill.

   Amendment 2 decision 1's formula is unchanged — `expectedBucketCount` still
   takes `windowMinutes` and the level. What changed is the window it counts
   over, so this is an erratum on the *reading* of decision 1, not a new
   formula.

   **No score changes.** The in-flight bucket carries no counter row by
   construction, so excluding it removes nothing from any numerator or
   denominator. Only the two coverage integers and `windowFrom`/`windowTo` move,
   and each moves by less than one bucket.

2. **The boundary rule has exactly one implementation.** `floorToBucket(instant,
   level)` moves to `apps/api/src/telemetry/point-aggregate-window.ts` —
   `F3.35`'s pure window module — and both `alignedWindow` and `resolveWindow`
   call it. Two copies of a boundary rule is how a writer and a reader come to
   disagree about which bucket is the newest, which is this amendment's whole
   subject.

3. **This is not a second ladder**, and Amendment 2 decision 2 still stands.
   `levelFor` is still `F3.35`'s and is still chosen from the **unaligned**
   window, so the retention guard keeps asking how far back the request truly
   reaches. The read still does not import `TRAILING_WINDOW_MS`, no rung moves,
   and `MAX_BUCKETS` is untouched.

### Consequences

- **A fully swept deployment now reports a whole window**, so the banner turns
  off and its presence again means something.
- **`windowTo` is no longer `now`.** A consumer comparing it against its own
  clock sees a lag of up to one bucket — 60 seconds at `1m`, a day at `1d`. That
  is the honest figure: it is the newest instant the roll-up could have written.
  `computedAt` remains the currency of the rows actually read and is unchanged.
- **The gate is an integration assertion, not a fixture.** `item 9` in
  `health-rollup.integration.spec.ts` reads real rows through the real window
  arithmetic with a deliberately **unaligned** `now`, so it fails if the
  alignment is removed. A hand-written fixture cannot hold this claim — that is
  what let the defect through the first time.
- **No migration, and no contract field added or removed.** Amendment 2's two
  integers are unchanged in name, type and meaning.
