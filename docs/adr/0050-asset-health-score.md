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
