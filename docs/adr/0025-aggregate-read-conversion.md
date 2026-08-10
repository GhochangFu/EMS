# ADR 0025 — Moving the remaining rollup reads onto the continuous aggregates

## Status

**Accepted (2026-08-10).** Backlog item `F4.28` (Wave 1, P1, effort 3–4),
created by **ADR 0023 decision 6** and unblocked by `F4.1` the same day.
Drafted and accepted the same day by the repo owner at the AGENTS.md §10 gate.

The one open question — whether the Energy Consumption CSV export reads raw
samples or the materialised hourly record — was **answered `_1h`**, taking the
recommendation and its three reasons. All six sites convert. The reasoning, the
rejected alternatives and what would have changed the answer are kept in
[Settled at the gate](#settled-at-the-gate) rather than deleted, because the
trade it accepts is real and a future reader will need to see that it was chosen
rather than overlooked.

`0025` is the next free number. `0020` remains reserved for the `E8.1`
encryption-at-rest retro (ADR 0019 §"Numbering, also settled" and
`docs/BACKLOG.md` §5). The `E5.1` row also names `0025`, but that is a derived
value in prose which its own text says to "treat as stale on sight rather than as
a reservation" — it has now been wrong three times, so this ADR takes the number
and the fix is to stop naming one there at all (see
[Promotion follow-ups](#promotion-follow-ups)).

## Context

ADR 0023 built four hierarchical continuous aggregates and converted **exactly
one** read site — `DashboardService.energySummary` — to establish the pattern.
Decision 6 named the other six and created `F4.28` to carry them, on the
explicit reasoning that naming deferred work only inside an ADR is how ADR 0016
§6 commit 4 stayed unowned. This is that item.

Two things have changed since, and both bear on it:

1. **ADR 0024 shipped retention.** Raw drops at 730 days; `_1m`/`_5m` at 735;
   `_1h`/`_1d` never. So "which level a read uses" is no longer only a
   performance question — it decides whether the read returns anything at all
   two years out.
2. **ADR 0024 withdrew its own decision 8** (a retention-aware level selector),
   on the premise that no selector existed and the reports path lands on `_1h`
   anyway. It explicitly assigned that debt here: *"`point-aggregates.ts` still
   owes the level selector its own module comment claims… that debt is about
   level choice and belongs to `F4.28`."*

**This item is the one that can falsify that premise**, which is why decision 1
is a guard rather than a convenience. Detail in decision 1.

### The six sites

| # | Site | Bucket today | Window shape | Level |
|---|---|---|---|---|
| 1 | `dashboard.service.ts:471` `loadTrend` | minute | trailing, `1–168` **m or h** | `_1m` |
| 2 | `dashboard.service.ts:701` `energySourceMix` | minute / hour | trailing, ≤**720 h** | `_1m` (<48 h) / `_1h` |
| 3 | `dashboard.service.ts:782` `energyTopConsumers` | **none** (bare `avg`) | trailing, ≤**720 h** | `_1m` |
| 4 | `reports.service.ts:133` `energySummary` | hour | explicit `start`/`end` | `_1h` |
| 5 | `reports.service.ts:180` `energySourceTotals` | hour | explicit `start`/`end` | `_1h` |
| 6 | `reports.service.ts:233` `energyTopConsumers` | **none** (bare `avg`) | explicit `start`/`end` | `_1h` |

Deliberately **excluded**, per ADR 0023 decision 6: `map.service.ts`,
`telemetry.service.ts`, `rules.service.ts`. They serve individual samples, which
is what a hypertable is already good at, and an aggregate would lose the samples
they exist to return.

## Measured facts

All measured 2026-08-10 against the live dev stack (TimescaleDB 2.29.1 /
PostgreSQL 16.14), with the simulator and the MQTT ingest both writing. The `kw`
series held **46,038 raw rows** spanning `2026-08-05 17:47:23` →
`2026-08-10 12:26:38`, and **174 `_1h` rows**. Every probe was a pure `SELECT`:
no DDL, no writes, and nothing that moves a watermark — deliberately, because
`F4.1`'s own suite poisoned the production aggregates by doing otherwise
(`eb8a55b`).

**1. All six sites convert exactly, and that is not luck.** Each site's current
raw query was run beside the aggregate form it would become, compared **per
output group** rather than on a total (ADR 0023 fact 4: a total-level comparison
passes for the wrong implementation):

| Site | Groups compared | Mismatches | Worst absolute error |
|---|---|---|---|
| 1 `loadTrend` | 94 minute buckets | 0 | **0** |
| 2 `energySourceMix` (hour) | 29 hour buckets × 2 series | 0 | 1.71e-13 |
| 3 `energyTopConsumers` | 29 assets | 0 | 1.42e-13 |
| 4 `reports.energySummary` | 29 hour buckets | 0 | 1.71e-13 |
| 5 `reports.energySourceTotals` | 2 whole-range sums | 0 | 9e-13 abs / **4e-16 rel** |
| 6 `reports.energyTopConsumers` | 37 assets | 0 | 1.21e-13 |

Site 4's window total was **2345.170321387197 kWh on both sides**; site 5's
**2345.1703213871983** raw vs **2345.1703213871974** aggregate, and its solar
slice **231.62068778874408** vs **231.62068778874416**. The residuals are float
summation order, the same artefact that produced a spurious "394 mismatches"
during `F4.2` before it was re-compared per group. Site 5's absolute residual is
the largest in the table only because its magnitude is — it is a whole-range sum
(~2345) rather than a per-bucket figure, and relative to that it is **4e-16**,
the same order as every other row. Compare relative, not absolute.

**Four of the six are exact structurally, not data-dependently**, which matters
because ADR 0023 Amendment 1 had to withdraw a parity claim for being a snapshot:

- Sites 1, 2, 4, 5 group by the level's **own** bucket width, so exactly one
  source row feeds each output group (fact 2) and `sum(sum)/sum(count)`
  degenerates to that row's own mean. Algebraic identity.
- Sites 3 and 6 do not bucket at all, so `sum(sum_value)/sum(sample_count)` is
  `sum(value)/count(value)` over the same rows. Also an algebraic identity —
  this is the one shape where the correct form is *provably* the raw answer.

What is **not** structural is the window predicate: raw filters on sample `time`,
an aggregate on `bucket` start. See fact 5 for why that is nevertheless closed
for sites 4–6, and decision 6 for sites 1–3.

**2. Fold factor is what decides whether a parity test proves anything, and for
four of the six sites it is 1.** Source rows feeding one output group:

| Read shape | Sites | Source rows per output group |
|---|---|---|
| `_1m`, minute buckets | 1, 2 (min branch) | **1** |
| `_1h`, hour buckets | 2 (hr branch), 4, 5 | **1** |
| `_1m`, no bucket, per asset, 24 h | 3 | up to **1172** |
| `_1h`, no bucket, per asset, full extent | 6 | 1–**26**, mean 4.7 |

Where the fold is 1 the correct and the naive (`avg` of per-bucket means) forms
are **algebraically identical**, so a per-bucket parity test at those four sites
cannot detect a regression in `avgExpr`. This is not a hypothesis: ADR 0023
proved it by mutation for `energySummary`, whose test **passed** with `avgExpr`
mutated to the naive form. The backlog row's "each needs the per-bucket equality
test" is necessary and, for four sites, **not sufficient** — see decision 5.

**3. The naive form's error is real at the two bare-`avg` sites, and it is not
uniform across assets.** Running both forms beside raw:

- Site 3 (`_1m`, 24 h): naive wrong in **29 of 29** assets, worst **0.0458 kW**.
- Site 6 (`_1h`, full extent): naive wrong in **29 of 37** assets, worst
  **11.193 kW** — and the **8** that agree are exactly the assets whose fold is
  1. A test that happens to assert on one of those 8 proves nothing while looking
  like it proves everything.

So even at a discriminating site the discrimination is **per asset**, not per
site. Decision 5 turns that into an assertion rather than a hope.

**4. Why the coarse level's error is 244× the fine level's.** `sample_count` at
`_1h` over this range runs **7 to 629, mean 264.6** across 174 rows. The naive
form weights every bucket equally, so its error scales with that spread; at `_1m`
the spread is 1–60 (ADR 0023 fact 4) and the error stays under 0.05 kW. The
`F4.28` conversion therefore makes the composition bug **more** consequential
than `F4.1` did, not less — the opposite of the intuition that coarser levels are
safer.

**5. The reports range is day-aligned by construction, so `_1h` has no partial
edge bucket.** This was the exposure I expected to be the gate question, and it
is closed by reading the code: `energyReportQuerySchema` constrains
`startDate`/`endDate` to `^\d{4}-\d{2}-\d{2}$`, and `parseRange`
(`reports.service.ts:86`) builds `${startDate}T00:00:00.000Z` and
`${endDate}T23:59:59.999Z`. A UTC day boundary **is** an hour boundary, so
`bucket >= start` selects exactly the buckets whose samples satisfy
`time >= start`, and the trailing bucket `23:00` covers exactly
`23:00:00.000–23:59:59.999`. Confirmed by fact 1: identical to 13 significant
figures.

The only residual is a **0.5 ms sliver** — a sample at `23:59:59.9995` would be
excluded from raw by `time <= …999` and included in the `_1h` bucket. Both
writers emit at second granularity, so no such row exists; recorded because it is
the kind of thing that becomes true when a writer changes.

**6. The MQTT ingest is currently writing 33 minutes into the future, and it
changes what the tests must expect.** Measured at `now() = 11:52:38`:
`max(time) = 12:26:38` on `kw`, all **714** future-dated rows from one RTU,
`RTU-861736076104923`, `source_type = mqtt`. This is the unclamped ingest
`sample.at` that ADR 0023 recorded and deferred to `F1.7`, and ADR 0024 fact 12
saw the empty future chunks it leaves — but here it is **live data**, not a stale
chunk.

Two consequences:

- A "trailing 60 minute" window spans **94** minute buckets, not ≤61. Any test
  that asserts a bucket count from the window width is wrong on this stack.
- Future-dated buckets sit past every level's `end_offset`, so the refresh
  policies **cannot** materialise them. They are served **only** by the
  real-time branch — the one deprecated upstream since 2.13. Parity holds today
  (fact 1 measured 0 mismatches across all 94 buckets, so the live branch is
  exact here as ADR 0023 fact 7 found), but if that branch is ever removed,
  future-dated telemetry disappears from every aggregate read while raw keeps
  it. That is a new argument for ADR 0023 decision 8's helper, not against the
  conversion.

**7. `reports.service.ts` has no tests at all.** `apps/api/src/reports/` holds
`reports.{controller,module,schema,service}.ts` and no `.spec`/`.test` pair. All
three of its rollups are on the CSV export path (`energyCsv` → `energyPreview`),
so `F4.28` writes the first coverage this file has ever had. This is not a §4.6
violation — the orphan invariant is about a `.spec` without a `.test` — but it
means sites 4–6 are being changed with no existing behavioural net under them.

**8. The `DATABASE_URL` integration-test gate is at six copies.**
`asset-templates.instantiate`, `asset-templates.lifecycle`, `audit`,
`access-control`, `point-aggregates` and `aggregate-retention`. `F4.28` would be
the seventh. Flagged as overdue during `F4.2`; decision 8 settles it.

## Decision

**1. Level selection becomes a function in `point-aggregates.ts`, keyed on how
far back the range reaches — never on duration alone — and it refuses rather
than silently returning a level whose data has been dropped.**

This is the debt ADR 0024 assigned here, and taking it up **falsifies the
premise on which ADR 0024 withdrew its decision 8**. That withdrawal reasoned:

> The report path is not a counterexample even though its `start` is unbounded:
> its 31 days is a cap on window *duration*, not on how far back the window may
> sit… and that is precisely why it buckets by hour and lands on `_1h`, which
> carries **no retention policy at all**.

True while level choice is *hard-coded* per site, which is the tree ADR 0024
reviewed. It stops being true the moment a **selector** exists, because the
obvious selector is the one `energySummary` already implements inline —
`useHourlyBuckets ? "1h" : "1m"`, a function of **duration**. Route the reports
sites through that and a 24-hour report dated three years ago selects `_1m`,
which ADR 0024 drops at 735 days, and facts 13/14 of that ADR say the result is
**0 rows, silently, and not rebuildable**. The guard ADR 0024 called "a test for
a gap the horizon already closed" is the thing that stops this item opening the
gap.

So the selector's signature takes the range, not just its width:

```ts
levelForRange({ start, granularity, now }): LevelChoice
```

Two corrections to what this decision first specified, both found by the `F4.28`
compliance review after the code was written, and recorded here rather than
quietly reconciled:

- It first wrote the signature as `({ start, end }) => AggregateLevel`. **`end` is
  gone**, which is what this decision's own prose below demands, so the first draft
  contradicted itself one paragraph later.
- `granularity` was never mentioned and is **not optional**. Level choice is not a
  function of the range alone: `loadTrend` plots minute buckets over windows up to
  168 hours while `energySummary` switches to hours at 48, so deriving granularity
  here would silently change what those charts plot. The caller states what it wants
  to display; the guard decides what it is allowed to read.
- The return is `LevelChoice`, not a bare level, so an escalation is visible to the
  caller rather than silent.

and its rule is: pick the finest level whose bucket width suits the range **and
whose retention horizon covers `start`**; escalate to a coarser level when it
does not. `_1h` has no horizon, so escalation always terminates. A level whose
horizon cannot cover `start` is never returned — not preferred-against,
**never returned**. Horizons live beside the levels in the same module so they
cannot drift from migration `0028` unnoticed, and a test asserts the pairing.

**The guard's reference point is `now()`, and `end` plays no part in it.**
Stated exactly: level `L` is admissible only if
`start >= now() - horizon(L)`. Spelling that out because "covers `start`" is
ambiguous in the one direction fact 6 makes real — **`end` can be in the
future.** For sites 4–6 it always is when the report covers today, since
`parseRange` sets `end` to `endDate T23:59:59.999Z`, up to ~24 hours ahead; and
fact 6's ingest puts *data* ahead of `now()` too. A guard that derived the range
width from `end`, or compared a horizon against `end`, would escalate levels for
reports on today's date — correct-looking, needlessly coarse, and untraceable.
Retention is a statement about age relative to wall-clock, so only `start` and
`now()` belong in it. This is the failure mode ADR 0024's review found twice in
that ADR's prose: a rule stated correctly for one query shape and applied to
another.

This needs **ADR 0024 Amendment 3** to correct its decision-8 rationale rather
than leaving a withdrawn decision whose stated reason this item invalidates.
Amending an accepted ADR is the owner's call; the amendment text is drafted with
the implementation, not here.

**2. Sites 4–6 read `_1h`; sites 1–3 read the level their existing branch
implies** — site 1 `_1m`, site 2 `_1m` under 48 h and `_1h` at or above it
(unchanged from `parseEnergyWindow`), site 3 `_1m`. Every one of them goes
through decision 1's selector rather than an inline ternary, and
`energySummary`'s existing inline choice is moved onto it in the same change so
there is exactly one implementation.

Subject to the gate question below, which is about sites 4–6 only.

**3. `bucketHours()` is used at every converted site that reports ENERGY,
including the ones pinned to `_1h`.** Four of the six report a mean or peak **kW**
— `loadTrend`, `energySourceMix` and both `energyTopConsumers` — and correctly do
not use it; an earlier draft of this decision said "every converted site", which
invites a future agent to "fix" the four that rightly abstain.

**And where a query has more than one energy term, every one of them carries the
factor.** `energySourceTotals` sums two — a total and a solar slice — from the same
CTE. Scaling only the total would misstate the solar share the moment the level is
not `_1h`, and **no behavioural test can see it**, because `bucketHours("1h")` is 1
and multiplying by it is a no-op. Verified: dropping the factor from `solar_kw`
alone leaves the integration suite reporting 5 passed. That is the same blind spot
decision 5b describes — a test invariant under the change it guards — so it is
closed the same way, by a static assertion in
`tests/adr-0025-level-selector.test.ts`. Caught before merge rather than after.

The two that do are `reports.service.ts:133` and `:180`, which currently treat
`SUM(total_kw)` as kWh directly. That is correct **only** because the buckets are
hours — an implicit factor of 1, nowhere written down. The dashboard's
`energySummary` already passes `bucketHours(level)` explicitly. Pinning to `_1h`
makes the implicit factor right today and silently wrong the first time anyone
changes the level, and decision 1 exists precisely to change levels. Make the
factor explicit where it is 1.

**4. Parity tests at all six sites, per output group, against the `date_trunc`
query being replaced, with a non-zero-group guard.** As the backlog row
requires. Float comparison with a tolerance, never exact equality — fact 1's
residuals reach 1.7e-13 from summation order alone.

**5. `avgExpr` is mutation-tested at sites 3 and 6 only, and the test asserts its
own fold.** This is the part the backlog row does not say and fact 2 requires.

| Sites | Fold | What the parity test proves | Mutate to prove it |
|---|---|---|---|
| 1, 2, 4, 5 | 1 | predicate translation, **level** choice, parameter binding, the kWh factor | the **level** (`_1m` → `_5m`) or the factor |
| 3, 6 | many→one | all of the above **and** `avg` composition | **`avgExpr`** → naive form; must fail |

At sites 3 and 6 the test additionally asserts that at least one compared group
draws **≥ 2** source rows. Without that, fact 3's finding bites: 8 of 37 assets
have fold 1 and agree under both forms, so an assertion that lands on one of them
is vacuous while reading as coverage. The four fold-1 sites get a comment saying
in one line what their test does and does not prove, so a future reader does not
count four green tests as `avg`-composition coverage.

**5b. No behavioural test here can detect a revert to bucketing raw, so a static
invariant carries that instead.**

This is a correction to decision 5 as first written, found by the `F4.28`
compliance review. That draft claimed the fold-1 parity tests prove the **relation
name**. They cannot, and the reason is structural: every assertion in the suite
compares a converted site against *the raw query it replaced*, so if a site reverts
to that query, the comparison is the query against itself.

Verified rather than reasoned. With `loadTrend` fully reverted to
`date_trunc('minute', time)` over `telemetry.point_values`, the suite reports
**5 passed**. Mutation testing does show the suite catches a wrong *aggregate
level* — `_1m` → `_5m` fails on bucket count, 19 against 90 — but raw at minute
granularity returns exactly what `_1m` returns, so that direction is invisible. The
two discriminating sites do not rescue it: their "the naive form differs from raw"
assertion is a property of the **fixture** and holds under a revert too.

So `tests/repo-invariants.test.ts` gains *"no rollup read reverts to bucketing raw
telemetry"*, asserting that neither service file contains `date_trunc` or an `avg`
over raw's `value` column outside comments. Between those two markers every one of
the six sites is covered, because a revert reintroduces at least one. Legitimate raw
reads in those files — latest-value `DISTINCT ON`, `MAX(value) FILTER`,
`SUM(latest.kw)` — use neither, and `AVG(total_kw)` over an already-aggregated CTE
is untouched because it does not name `value`. This is the same idiom as the ADR 0017
write-gate invariant: a guarantee no behavioural test can carry, so the repo asserts
it structurally.

**6. The trailing-window predicate keeps `energySummary`'s shape —
`bucket > now() - $n::interval` — and the tolerance is documented rather than
measured away.** Sites 1–3 are trailing windows whose leading edge falls mid-
bucket, so the aggregate form excludes a bucket that raw partially includes: up
to one bucket of under-count at the leading edge. That semantics shipped and was
accepted at the ADR 0023 gate for `energySummary`; sites 1–3 inherit it rather
than reopening it. Fact 1 measured 0 unmatched buckets over 94, but that is
alignment on this dataset, so the parity tests must tolerate one boundary bucket
rather than assert exact set equality and go red on a timing accident.

**That tolerance is confined to the bucketed sites — 1 and 2 — and must not
reach sites 3 and 6.** Those two produce **no buckets**: they fold every source
row for an asset into one mean (fold up to 1172, fact 2). A "one boundary
bucket" tolerance there is not a tolerance on set membership, it is a tolerance
on the **value** — an extra minute bucket inside an asset's mean moves it by
about the magnitude of the naive-form error the same test exists to detect
(0.046 kW, fact 3). The mutation test in decision 5 would then pass under a
tolerance wide enough to hide the defect, which is the ADR 0023 failure repeated
with a different mechanism. So sites 3 and 6 pin both range edges to bucket
boundaries — trivially true for 4–6, which are day-aligned already (fact 5), and
for site 3 done by dating the fixture entirely inside the window, far from either
edge.

**The tolerances are then set by rounding, not by float error, and an earlier draft
of this paragraph claimed 1e-9.** It was never reachable: every converted method
rounds its output to 2 dp, so the assertions compare against a rounded reference at
`<= 0.005` on the two discriminating means, `<= 0.02` on totals reconstructed from
three rounded components, and `1e-6` on the report summary. Discrimination does not
depend on tolerance width at all — it is guaranteed by asserting the naive form
differs from raw by more than `0.01`, which is a separate assertion the tolerance
cannot swallow.

Fact 6 matters here: with data 33 minutes ahead of `now()`, tests must derive
expected bucket counts from the data, never from the window width.

**7. The excluded three stay excluded** — `map.service.ts`,
`telemetry.service.ts`, `rules.service.ts`, for ADR 0023 decision 6's reason.
Recorded again because "move the rollup reads onto aggregates" invites a sweep,
and a sweep here would delete the individual samples those endpoints exist to
return.

**8. The `DATABASE_URL` gate is extracted, in its own commit, before the
conversion.** Six copies (fact 8) of a gate whose asymmetry is subtle — skip
locally, **throw** in CI — is one bad copy away from a suite that silently never
runs in CI. It lands as a separate commit so the conversion diff stays readable
and the extraction can be reviewed as the mechanical change it is.

That first commit touches six files this item otherwise does not, and has no
behaviour of its own to test, so **the extraction is verified by mutation**: with
the helper's CI branch disabled it must **fail** in CI mode and still skip
locally. Asserting only that the six suites still pass proves nothing — they pass
either way on a machine with `DATABASE_URL` set, which is the exact shape of the
`F4.1` test that passed under a mutated `avgExpr`.

**9. Coverage ratchet moves in the same PR**, per ADR 0014. Fact 7 means sites
4–6 add the first tests `reports.service.ts` has had, so the movement should be
material; the thresholds are set from a measured run, not predicted.

## Dependencies

**None.** No new npm package, so nothing here is §9.4-gated. No migration and no
schema change: every level, policy and view this item reads already exists from
migrations `0027` and `0028`. `packages/db` is not touched.

## Consequences

- **`F4.1 ✅` starts meaning what it says.** Seven of seven rollup reads on the
  aggregates, and the "reads are on aggregates" claim stops needing the
  qualification ADR 0023 decision 6 attached to it.
- **The reports path survives retention.** Today sites 4–6 read raw, which ADR
  0024 drops at 730 days — so a 2029 report over a 2026 range returns zeros from
  a healthy system. On `_1h` it returns the hourly record, which is never
  dropped. This is a **correctness** consequence, not a performance one, and it
  is the strongest argument for converting sites 4–6 at all.
- **A mixed tree stays safe while this lands.** ADR 0023 fact 7 puts the live
  branch at 7.1e-14 against raw, and fact 1 here re-confirms it across all six
  sites, so a converted and an unconverted site on the same dashboard cannot
  disagree. Sites may therefore land one commit at a time.
- **ADR 0024 needs Amendment 3** (decision 1). Its withdrawn decision 8 is not
  wrong about the tree it reviewed; its stated reason stops holding here.
- **Deliberately not taken, and named so it is not mistaken for done:**
  - The unclamped ingest `sample.at` (fact 6) belongs with `F1.7`. This item
    works around it in test expectations and does not fix it.
  - Widening `_1h`'s `start_offset` to catch later arrivals (see the gate
    question) is a policy change to migration `0027`'s refresh policies, not a
    read-site change, and does not belong here.
  - The real-time-branch fallback (`UNION ALL` raw past `now() - end_offset`)
    stays unbuilt. Fact 6 adds future-dated data to the list of things that
    depend on it; ADR 0023 decision 8 already keeps it to one file.
  - No compose service has a `restart:` policy — pre-existing, flagged in the
    `F4.2` backlog row, still unowned.

## Settled at the gate

**One question was open, and it was not an engineering one.** It was answered
**`_1h`** by the repo owner on 2026-08-10: all six sites convert, and the export
becomes a statement about the materialised hourly record. The analysis is kept
below because the trade is real — the export now misses samples arriving more
than three days late, and that was **chosen**, not missed.

**Did sites 4–6 — the Energy Consumption CSV export — read raw samples or the
materialised hourly record?**

The two diverge, in opposite directions, and the export is what a client sees:

| | Late arrivals | Ranges older than 730 days |
|---|---|---|
| **raw** (today) | included, always | **returns zeros** — ADR 0024 drops raw |
| **`_1h`** (proposed) | **missed** if > 3 days late | correct; `_1h` is never dropped |

The `_1h` column's gap is `start_offset = INTERVAL '3 days'` in migration `0027`:
a bucket behind the watermark is served from stored rows only, so a sample
arriving more than three days late is permanently absent from `_1h` while
present in raw. ADR 0023 recorded that behaviour; this is the first read path
where it lands on a client deliverable rather than a dashboard.

**The answer, and the three reasons it rests on — `_1h`:**

1. The raw column's failure is **worse and unavoidable** — silent zeros on a
   healthy system, on a fixed two-year fuse, with no operator action that
   prevents it. The `_1h` column's failure requires telemetry more than three
   days late, which on the MQTT path means a gateway offline for three days.
2. Late arrivals beyond three days are **already invisible** to every dashboard
   read, including the `energySummary` that shipped in `F4.1`. Keeping reports on
   raw makes the export disagree with the dashboard rather than making it more
   accurate.
3. If three days is too tight, the fix is **widening `_1h`'s `start_offset`** —
   one line in a policy, applying uniformly to every reader — not keeping one
   read path on a relation that expires.

**What would reopen this, and it is not hypothetical.** If the Ion Exchange
engagement turns out to need the export to be a statement about *samples as
received* — a compliance posture rather than an operational one — then sites 4–6
belong back on raw and the 730-day cliff becomes an item of its own. That is the
same question already routed to the `E5.1` client mail, where ADR 0024's
`drop_after` note asked whether any compliance obligation needs sample-level
effluent data beyond two years.

Two alternatives were on the table at the gate and both were declined: keeping
sites 4–6 on raw (narrowing `F4.28` to the dashboard three), and landing sites
1–3 now while holding 4–6 for that reply. The second was cheap — the mixed tree
is provably safe by fact 1, so splitting would have cost only a second PR — and
it was declined in favour of converting all six now. **The consequence to carry
forward:** if the `E5.1` reply says sample-level data is required, reverting
sites 4–6 is a code change to three read sites, not a migration, and nothing in
this ADR makes it harder. Nothing is dropped before 2028, so the reply cannot
arrive too late to act on.

## Promotion follow-ups

**Nothing to promote from §6.** `F4.28` is an active Wave 1 backlog row, not
out-of-scope, and ADR 0023's and ADR 0024's sweeps both searched §6 for an
aggregates/rollup/scale line and recorded its absence. Verify and record again
rather than adding a line in order to soften it.

**§9.10-bound — one `chore(agents):` PR, separate from the feature, ADR 0025
alone per §10.1:**

- AGENTS.md status line gains ADR 0025.
- **§2 *Telemetry aggregates*** — "one converted site so far
  (`DashboardService.energySummary`); the other six rollups are `F4.28` and still
  read raw" becomes false on merge. It should name the selector as the single
  place level choice happens, and the three sites that stay on raw *by decision*.
- **§4.4** — "read rollups through the helper" gains: level choice comes from
  the selector, never an inline ternary; a level is never chosen by window
  duration alone; and `bucketHours()` is used even where the factor is 1.
- **§4.4 again, and this one is a gap this item creates.** The post-`DELETE`
  refresh rule — added by ADR 0023's sweep and made *conditional* by ADR 0024's —
  currently has two cases: refresh after deleting from raw, unless raw no longer
  holds the range. `F4.28`'s suite is a **third**: raw holds the range, but nothing
  was ever materialised over it, so there is nothing to repair and a refresh would
  be the harmful act. That is safe here only because the suite **proves** it
  (`assertFixtureIsOnlyOnTheLiveBranch` premise 2, and `assertSuiteLeftNoOrphans`
  after the delete) rather than assuming it. Without the clause, §4.4 as written
  literally requires a refresh this suite correctly omits, and the next agent reads
  the omission as licence rather than as a proven exception. Raised by the `F4.28`
  compliance review.
- **§3** — the new `apps/api/src/testing/` directory. §3's literal rule is
  top-level folders, but the practice is broader: ADR 0015's sweep added
  `src/admin/asset-templates/` to the tree and ADR 0022's sweep explicitly recorded
  "§3 needs nothing" after evaluating it. This directory has a stronger claim than
  most — it is the only `src/` directory excluded from `tsconfig.build.json`, i.e.
  the only one that is deliberately *not* runtime code.
- **`docs/BACKLOG.md` §5** — the owed-sweep row. §10.1 says what is owed is tracked
  there until it lands, and the precedent is unambiguous: ADR 0024's row was added
  in the **feature** stream (`7aac5b5`), not in the sweep. `BACKLOG.md` is not
  §9.10-gated, so it belongs in the feature branch. Added there.
- **`docs/BACKLOG.md`'s `F4.1` row** contains "the other six rollup sites **stay on
  raw**" in the present tense — the sentence ADR 0023 wrote specifically so `✅`
  could not be misread. It reads as current after this merges.
- **§4.6** — the extracted `DATABASE_URL` gate (decision 8) needs naming where
  the carve-out and the gate asymmetry are already described, or the next
  integration test copies a seventh gate from an older file.
- `docs/roadmap.md` gains an `F4.28` section.
- `docs/BACKLOG.md` §1 WAVE 1 and the `F4.28` row status.

**Not §9.10-bound, and owed by the owner rather than the sweep:** ADR 0024
Amendment 3 (decision 1).
