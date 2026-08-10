# ADR 0023 — Telemetry continuous aggregates (`F4.1`)

## Status

**Accepted (2026-08-10).** Backlog item `F4.1` (Wave 0, P0, ⭐ enabler, no
dependencies). Drafted and accepted the same day by the repo owner at the
AGENTS.md §10 gate.

Three points were **open at the gate and settled by it**, and each changed a
decision rather than confirming it: the conversion scope is one read site plus a
new `F4.28` row for the other six (decision 6); **both** `_1h` and `_1d` outlive
raw, not `_1d` alone (decision 7); and the compose image is pinned in its own
change with the tail strategy behind a helper (decisions 4 and 8).

`0020` stays reserved for the E8.1 encryption-at-rest retro, as `BACKLOG.md` §5
and ADR 0019's numbering note both record. `0021` went to `F4.14` and `0022` to
`E8.3`, so this ADR takes **`0023`**.

**`BACKLOG.md`'s `E5.1` row is now stale on numbering** — it says "its ADR is
unwritten and would be **0022**", which was true when written and is wrong
twice over. That is a one-line correction to that row, owed separately; it is
not bundled here.

## Context

`telemetry.point_values` has been a TimescaleDB hypertable since ADR 0001
(`packages/db/drizzle/0000_sprint1_foundation.sql:52`, 1-day chunks). In the
five years since — measured 2026-08-10 on the pilot database — **nothing in the
product has ever used a Timescale feature beyond the hypertable itself**. There
is not one `time_bucket` call in `apps/api`. Every rollup is `date_trunc` over
raw rows:

| Site | Bucket |
|------|--------|
| `dashboard.service.ts:465` | `minute` |
| `dashboard.service.ts:629` (`energySummary`) | `minute` or `hour` |
| `dashboard.service.ts:681` (`energySourceMix`) | `minute` or `hour` |
| `dashboard.service.ts:762` | none (bare `avg`) |
| `reports.service.ts:133`, `:180` | `hour` |
| `reports.service.ts:233` | none (bare `avg`) |
| `map.service.ts`, `telemetry.service.ts`, `rules.service.ts` | raw reads |

That is affordable today and will not be. Measured on the pilot database
(TimescaleDB **2.29.1** / PostgreSQL 16.14, 621,043 rows, 49 point keys, 78
assets, five days):

- `energySummary`' hourly rollup: **144.7 ms cold / 32.7 ms warm**.
- The same result from a 1-minute continuous aggregate: **11.8 ms cold /
  5.4 ms warm** — 12× and 6×.

`F4.8` targets 5,000 meters at 1 Hz. That is ~432 M raw rows/day against
~7.2 M at one-minute granularity. The read cost above scales with the raw row
count; the aggregate cost does not.

`F4.1` is chosen now because it is Wave 0, P0, has no dependencies, and is the
one ⭐ enabler on the board whose absence is *already* priced into every
dashboard query. It also gates `F4.2` (retention), `F3.5` (scheduled reports)
and `E1.1` (ML serving, which reads features "from aggregates").

### Eight facts measured before drafting, each of which changed the design

1. **`refresh_continuous_aggregate()` cannot run inside a transaction block.**
   Confirmed by execution, verbatim error. `packages/db/src/migrate.ts` uses
   Drizzle's `node-postgres` migrator, which wraps the run in one transaction.
   **Backfill therefore cannot live in a migration** — see decision 5.

2. **`CREATE MATERIALIZED VIEW … WITH (timescaledb.continuous) … WITH NO DATA`
   and `add_continuous_aggregate_policy()` *can*.** Both succeeded inside a
   rolled-back transaction. So the DDL is a normal migration; only the refresh
   is not.

3. **Aggregate-on-aggregate works** on 2.29.1 — a 1-hour continuous aggregate
   over a 1-minute one created cleanly. Hierarchical rollup is available and
   decision 3 uses it.

4. **`avg` does not compose, and this data proves it rather than illustrating
   it.** Building the hourly figure as `avg(avg_value)` over minute buckets was
   wrong in **151 of 169 buckets**, worst error **0.58 kW**, because
   `sample_count` per minute bucket ranges from **1 to 60** on real pilot data
   (1097 buckets with 1 sample, 3164 with 12, 29 with 60). The
   sum-and-count form was exact to 8.5e-14. A total-level check does *not*
   catch this: summed over the window both forms gave 2311.9, because the
   per-bucket errors cancelled. **The verification has to be per bucket.**

5. **On 2.29.1 `timescaledb.materialized_only` defaults to `true`, not
   `false`.** Measured: a freshly created aggregate with no materialization
   returned **0 rows** while raw data existed, and after refreshing only up to
   `now() - 1 hour` its newest bucket was **1 h 35 m behind** the newest raw
   row. Setting the flag to `false` explicitly returned **68,530 rows with zero
   materialization** and a newest bucket equal to the raw tail. On a real-time
   monitoring platform the default is the dangerous value, and it is the
   default — see decision 4.

6. **Real-time aggregation composes up a hierarchy.** Facts 3 and 5 together
   are not enough: fact 5 was measured on a 1-minute aggregate over the raw
   hypertable, and three of the four views here read *another aggregate*. If
   the live branch of a parent read only its child's materialization
   hypertable, decision 3 would silently defeat decision 4 for `_5m`, `_1h` and
   `_1d`.

   It does not. All three levels were built with `materialized_only = false`
   and **nothing refreshed anywhere**; against a raw tail of `07:17:11` they
   returned `07:17:00` (`_1m`), `07:15:00` (`_5m`) and `07:00:00` (`_1h`) —
   each the current partial bucket boundary, which is the correct answer, not
   lag — over 68,614 / 15,081 / 2,399 rows.

7. **The `sum`/`count`/`min`/`max` composition is exact three levels deep.**
   The same fully un-materialized chain (raw → `1m` → `5m` → `1h`) was compared
   per bucket against `date_trunc('hour', …)` over raw for `point_key = 'kw'`:
   169 buckets, worst `avg` error **7.1e-14**, `min` and `max` errors exactly
   **0**, and **zero** `sample_count` mismatches. Contrast fact 4, where the
   naive form was wrong in 151 of those same 169 buckets.

8. **Size and refresh cost per level**, over the same five days, which is what
   decisions 6 and 7 are priced from:

   | Level | Rows | On disk | Full refresh |
   |-------|------|---------|--------------|
   | raw `point_values` | 621,547 | **161 MB** | — |
   | `_1m` | 68,908 | 11 MB | 7.41 s |
   | `_5m` | 15,144 | 2.5 MB | 1.90 s |
   | `_1h` | 2,399 | 480 kB | 0.34 s |
   | `_1d` | 1,278 | 304 kB | 0.11 s |

   Two things follow. The three levels above `_1m` cost **24% of `_1m`'s
   refresh** between them, so the hierarchy is close to free once `_1m` exists
   (decision 6). And `_1h` + `_1d` together are **0.5% of raw's footprint**, so
   retaining them indefinitely is not a trade-off worth arguing about
   (decision 7). Extrapolated at pilot volume: raw ≈ 11.8 GB/year, `_1h` ≈ 35
   MB/year, `_1d` ≈ 22 MB/year.

## Decision

1. **Four continuous aggregates in `telemetry`**, named as the backlog row
   names them: `point_values_1m`, `point_values_5m`, `point_values_1h`,
   `point_values_1d`. Grouping is `(bucket, asset_id, point_key)` at every
   level, matching the raw primary key's identity columns.

2. **The stored columns are `sum_value`, `sample_count`, `min_value`,
   `max_value`, `unit`. There is no `avg_value` column, at any level.**

   `avg` is a **read-time expression** — `sum(sum_value) / sum(sample_count)` —
   and never a stored one. This is measured fact 4 turned into a rule: `min` and
   `max` compose up the chain, `sum` and `count` compose, `avg` does not. An
   `avg_value` column that exists will be read by someone downstream, and
   reading it reintroduces a 151-in-169 error that no total-level test detects.

   **The upward composition is written out because getting it wrong is the same
   error one level up.** Every level above `_1m` reads its source level as:

   ```sql
   sum(sum_value)      AS sum_value
   sum(sample_count)   AS sample_count
   min(min_value)      AS min_value
   max(max_value)      AS max_value
   ```

   Not `avg(sum_value)`, not `min(sum_value)`, not `count(*)` — `count(*)` at
   the `5m` level counts *minute buckets*, not samples, and would divide by 5
   instead of by 60. Measured fact 7 is what this form buys: exact to 7.1e-14
   three levels deep, with `sample_count` matching raw on every bucket.

   `unit` is carried as `max(unit)`. Verified 2026-08-10: **zero**
   `(asset_id, point_key)` pairs carry more than one distinct unit across all
   621,043 rows, so the aggregate cannot currently mask a unit conflict. This
   is a measurement of today's data, not a constraint the schema enforces —
   `point_values.unit` is nullable and unconstrained, and enforcing one unit
   per point belongs with `F1.9`/`E1.x` point metadata, not here.

3. **The chain is hierarchical**: `1m` from `point_values`, `5m` from `1m`,
   `1h` from `5m`, `1d` from `1h`. Each level's bucket width divides evenly
   into the next. Flat aggregates each scanning raw would put four full scans
   of a 432 M-row/day table on the refresh path; hierarchical puts one.

   **The invariant that makes it safe**, in source-level terms so it can be
   asserted rather than interpreted. For any level `L` reading source level `S`:

   ```
   end_offset(L)  ≥  end_offset(S) + bucket_width(L)
   ```

   `S` is materialized only up to `now() - end_offset(S)`. If `L` materialises a
   bucket that extends past that point, it stores a figure computed over a
   source that was not yet complete — and **the live branch does not save it**,
   because for an already-materialized bucket the stored value wins; measured
   fact 6 only covers the *un*-materialized tail. The result is a silently
   understated bucket that stays wrong until a later scheduled run happens to
   re-cover it inside `start_offset`. That is the ADR 0016 `notify=off` shape:
   rows keep landing, numbers keep rendering, nothing errors.

   **An earlier draft of this ADR stated the rule as "at least the parent
   level's bucket width" and gave an offset table that violated its own rule at
   three of four levels** (`_5m` at 5 min needed 6; `_1h` at 1 h needed 1 h
   5 min; `_1d` at 1 d needed 1 d 1 h). It is recorded rather than quietly
   corrected because the test in decision 5 is written from this paragraph, and
   a test written from the wrong direction of the inequality would have passed
   against the wrong table. The offsets below satisfy the rule with margin.

   It is asserted against `timescaledb_information.continuous_aggregates` and
   the live job catalog, not left to review — so adding a fifth level, or
   tuning one offset, cannot break the chain silently.

4. **`timescaledb.materialized_only = false` is set explicitly on all four**,
   with the measurement from fact 5 in a comment beside it.

   This is not redundancy against a default; on 2.29.1 it is the *opposite* of
   the default, and it is what keeps the right-hand edge of every live view
   correct. Without it the dashboard silently reports data that is stale by
   `end_offset` plus the refresh interval, with no error anywhere.

   **The image must be pinned, in its own change, before this lands.**
   `docker-compose.yml:5` runs `timescale/timescaledb:latest-pg16` — an
   unpinned tag. Real-time aggregation has been deprecated upstream since 2.13
   and still functions in 2.29.1; a `docker compose pull` that lands a version
   removing it would take every live view's right edge stale, silently, with no
   code change on our side.

   That risk exists **today**, independent of this ADR — an unpinned tag lets
   the database version change under a running pilot for any reason. This ADR
   only makes one consequence sharper. The pin is to
   **`timescale/timescaledb:2.29.1-pg16`** — verified 2026-08-10 to exist
   upstream, and the exact version the stack is already running, so it is
   operationally a no-op that removes a silent-drift path.

   It is **not** in the `F4.1` PR. A compose change has its own justification
   and bundling it would make a telemetry PR look like it is taking infra
   decisions. `F4.24` is P2 and `F4.27` is Wave 4, so leaving it to them means
   carrying an unpinned database for months; it goes as a separate one-line
   change instead.

5. **Refresh policies per level, and backfill lives outside the migration.**

   | View | Source | `schedule_interval` | `start_offset` | `end_offset` | Invariant floor |
   |------|--------|--------------------|----------------|--------------|-----------------|
   | `_1m` | raw | 1 min | 3 h | **1 min** | 1 min (raw is never lagged) |
   | `_5m` | `_1m` | 5 min | 12 h | **10 min** | 6 min |
   | `_1h` | `_5m` | 30 min | 3 d | **2 h** | 1 h 10 min |
   | `_1d` | `_1h` | 1 h | 30 d | **2 d** | 1 d 2 h |

   `start_offset` is generous on purpose: ingest can deliver late (ADR 0007's
   MQTT path has no ordering guarantee), and a window that only covers the
   present silently drops late arrivals.

   **What the larger `end_offset` values cost:** the materialized edge sits
   further back, so more of a read near the tail is served by the live branch
   instead of stored rows. That is a CPU cost on recent queries, not a
   correctness one — measured fact 7 shows the live branch is exact three levels
   deep. Paying it is strictly better than materialising an understated bucket
   that no error surfaces.

   Because of measured fact 1, the **initial backfill is a separate script**,
   `packages/db/src/refresh-aggregates.ts`, exposed as
   `pnpm db:refresh-aggregates`, calling `refresh_continuous_aggregate` per
   level **oldest level first** (1m → 5m → 1h → 1d; refreshing a parent before
   its child materialises nothing).

   **Who it is for: an existing database with history.** The pilot carries data
   older than any policy window — `_1m`'s `start_offset` is 3 hours — so without
   this run everything older stays unmaterialized indefinitely. Reads stay
   *correct* via the live branch; they just keep paying the raw scan this feature
   exists to remove. Full backfill of `_1m` over the pilot's 621,043 rows
   measured **7.41 s**.

   **Correction, made while building rather than after review.** This decision
   originally justified the CI wiring as "an aggregate that is empty in CI makes
   any test touching it pass vacuously". **That reason is false.** `db:seed`
   inserts **zero** `telemetry.point_values` rows — verified 2026-08-10; only
   `apps/sim` and `apps/ingest` ever write that table — so on a freshly seeded
   CI database all four aggregates are legitimately empty and this script is a
   no-op there. Backfilling could not have made any test non-vacuous, and a
   non-zero-bucket guard in the suite would simply have failed in CI.

   What actually prevents the vacuous pass is decision 6: **the suite inserts
   its own telemetry fixture.** The script stays in CI for a narrower and honest
   reason — an unexercised script rots, exactly as `apps/ingest/Dockerfile` sat
   broken on `main` while CI stayed green (`F1.1`, migration `0017`'s neighbour
   in that story). Empty is not an error and the script does not treat it as one.

6. **Exactly one read site converts in `F4.1`, and it is verified by equality
   against the raw query it replaces.**

   `DashboardService.energySummary` (`apps/api/src/dashboard/dashboard.service.ts:622`)
   reads `point_values_1m` or `point_values_1h` per its existing
   minute/hour branch. It is chosen because it is the query benchmarked above
   and the one whose shape (`per` → `agg` → KPIs) recurs at five other sites,
   so converting it establishes the pattern.

   The test asserts the aggregate-backed result equals the `date_trunc` result
   **per bucket**, to float tolerance — per measured fact 4, a total-level
   assertion passes for the wrong implementation — and asserts a **non-zero
   bucket count first**, so a suite that finds nothing fails instead of passing.

   **The suite inserts its own `telemetry.point_values` fixture.** It cannot rely
   on seeded data: `db:seed` writes **zero** telemetry rows (verified
   2026-08-10 — only `apps/sim` and `apps/ingest` write that table), so a test
   reading whatever the seed left would compare 0 buckets against 0 buckets and
   go green having asserted nothing. The fixture is built with **deliberately
   uneven sample counts per minute bucket**, because an even fixture is exactly
   the one on which the wrong (`avg`-of-`avg`) implementation also passes.

   **Both branches are asserted, in one run.** After inserting the fixture the
   suite checks equality with **nothing materialized** — which exercises the
   real-time branch every read near the tail uses — then calls
   `refresh_continuous_aggregate` and checks equality again, now served from
   stored rows. The two paths are different code in TimescaleDB and only the
   second one exists on a lagged view.

   **A mixed tree is provably consistent, which is what makes converting one
   site defensible rather than lazy.** Measured fact 7 puts the live branch at
   7.1e-14 against raw, so a dashboard where `energySummary` reads `_1h` while
   `energySourceMix` still reads `date_trunc` over raw **cannot show two
   different numbers**. Correctness was the only thing that would have forced a
   big-bang conversion, and it does not.

   Nor is the refresh cost of the unread levels an argument against: measured
   2026-08-10 over the pilot's five days, a full rebuild costs **7.41 s
   (`_1m`) + 1.90 s (`_5m`) + 0.34 s (`_1h`) + 0.11 s (`_1d`)**, so the three
   higher levels together are **24% of `_1m`'s cost** — and `_1m` is required at
   pilot volume whatever reads it, while `F4.2` needs all four to exist to mean
   anything.

   **The remaining six rollup sites get their own backlog row, `F4.28`, not a
   paragraph in this ADR.** `dashboard.service.ts:465`, `:681`, `:762`,
   `reports.service.ts:133`, `:180`, `:233`. Naming deferred work only in an
   ADR is the failure this repo has already had once: ADR 0016 §6 commit 4 was
   real, understood and unowned, and `F1.1` sat at `⬜` looking undelivered
   because no row carried it. A row costs one line and makes `F4.1 ✅` mean what
   it says.

   The raw reads in `map.service.ts`, `telemetry.service.ts` and
   `rules.service.ts` are **not** in `F4.28` and should stay on raw —
   `telemetry.service.ts` serves recent samples for a single point, which is
   what a hypertable is already good at, and an aggregate would lose the
   individual samples it exists to return.

7. **No retention and no compression here — but `_1h` and `_1d` must outlive
   raw, and that constraint is set now.**

   Retention and compression are `F4.2`, whose row reads "incl.". One thing
   cannot wait for it, because `F4.2` would otherwise be free to decide it by
   omission: `drop_after` on `point_values` makes the aggregates the **only**
   long-term record. `F4.2` may compress any level and may drop raw; it may
   **not** drop `_1h` or `_1d` without its own decision.

   **Both, not just `_1d`.** Measured 2026-08-10 over five days of pilot data:
   raw is **161 MB** (≈11.8 GB/year), `_1h` **480 kB** (≈35 MB/year) and `_1d`
   **304 kB** (≈22 MB/year). Retaining both indefinitely costs **~0.5% of
   raw**. `_1d` alone cannot answer "what was the peak hour in March two years
   ago", which is exactly what an ISO 50001 energy baseline (`F4.19`) and the
   `E4.x` analytics ask for — so protecting only the daily level would trade a
   0.3%-of-storage saving for the loss of the resolution those items need.

   `_1m` and `_5m` are the bulk (11 MB and 2.5 MB per five days) and carry no
   such constraint; their retention ladder is `F4.2`'s to choose.

8. **Aggregate reads go through one helper, not inline SQL per call site.**

   A single module — `apps/api/src/telemetry/point-aggregates.ts` — owns bucket
   selection (which level answers a given window), the `sum_value /
   sample_count` expression from decision 2, and the tail strategy.

   The tail strategy is the reason it is a helper rather than a convention.
   Real-time aggregation is deprecated upstream (decision 4). If a future
   TimescaleDB removes it, the fallback is already known — read the aggregate
   for the settled part and `UNION ALL` raw for the tail past
   `now() - end_offset` — and with a helper that is a change in **one** file
   instead of in every site `F4.28` will have converted by then. Cheap
   insurance against a documented deprecation.

9. **`packages/db/src/schema/telemetry-schema.ts` gains read-only Drizzle view
   definitions** for the four aggregates so typed reads are possible, marked as
   views. Drizzle does not manage continuous aggregates; the migration is
   hand-written SQL, exactly as the hypertable itself is
   (`AGENTS.md:159` — "raw SQL for one Timescale hypertable" becomes "for the
   Timescale hypertable and its aggregates", a §10 follow-up).

## Dependencies

**None.** No npm package is added, so AGENTS.md §9.4 is not engaged.
Continuous aggregates, compression and retention policies are TimescaleDB
Community features under the TSL, already present in the image the stack has
always run — this ADR adds no licence surface that was not already there. The
compose pin in decision 4 changes the tag from `latest-pg16` to the version
already running (`2.29.1-pg16`); it adds no dependency and removes no feature.

## Consequences

- **Migration `0027_continuous_aggregates.sql`** — additive DDL, forward-only
  (§4.5). It takes no lock on `point_values` beyond what
  `CREATE MATERIALIZED VIEW … WITH NO DATA` needs, and creates four background
  jobs. Reviewable by `migration-reviewer`, which must see the journal entry
  (idx 27) as well as the file.
- **A new operational surface: four scheduled jobs.** They can fail silently.
  Verification is not "the policy exists" but
  `timescaledb_information.job_stats.last_run_status = 'Success'` after the
  first scheduled window — a policy that never fires is indistinguishable from
  a working one until the data is visibly stale. `F4.25` (SLO instrumentation)
  should surface aggregate lag; it is not surfaced by this ADR.
- **Refresh CPU is paid forever, per level, whether or not anything reads it** —
  but measured fact 8 prices it: the three levels above `_1m` are 24% of `_1m`'s
  refresh between them. It is still the argument for decision 6 converting a
  read site rather than landing four aggregates nothing queries.
- **`F4.2` is unblocked** (its only dependency), and inherits decision 7's
  constraint: `_1h` and `_1d` are not droppable without its own decision.
- **`F4.28` is created by this ADR**, carrying the six remaining rollup sites.
  It depends on `F4.1` and on nothing else.
- **A separate one-line compose change pins the database image** to
  `timescale/timescaledb:2.29.1-pg16` (decision 4). It is not in this PR and it
  is not deferred to `F4.24`/`F4.27`.
- **Deferred:** a unit constraint on `point_values` (decision 2) and
  aggregate-lag alerting (above, `F4.25`).

## Amendment 1 (2026-08-10) — the window predicate is a semantic change, and "exact parity" overclaimed

Raised by the migration review, which measured a divergence this ADR's own
verification could not have found. **Corrected here rather than left as
provenance, because the claim was the headline.**

`energySummary` used `time > now() - $1::interval` on raw sample timestamps and
then bucketed; it now uses `bucket > now() - $1::interval` on the aggregate's
bucket **start**. Those are not the same window. The old form admitted the
*partial* bucket containing the cutoff and — because `kwhFactor` is per whole
bucket — weighted it as a full one. The new form excludes it.

**The parity claim was true as measured and false as stated.** Re-measured
2026-08-10 across the pairings the code actually uses, after repairing the
watermarks (see below):

| Window | Level | Buckets | Old kWh | New kWh | Δ |
|--------|-------|---------|---------|---------|---|
| 24 h | `_1m` | 982 = 982 | 649.7428 | 649.7428 | **0.0000%** |
| 48 h | `_1h` | 17 = 17 | 815.7867 | 815.7867 | **0.0000%** |
| 7 d | `_1h` | 25 = 25 | 2311.9262 | 2311.9262 | **0.0000%** |

Exact on every real pairing — but **data-dependent, not structural**. Windows
are whole hours or days while `now()` is not, so the cutoff always lands
mid-bucket; the two forms agree only when that partial bucket happens to be
empty, which is what the pilot's ~1-sample-per-minute cadence produces. The
review's 18% figure came from a 6-hour window against `_1h`, a pairing
`parseEnergyWindow` never produces (`useHourlyBuckets` is `n >= 48`), so it
overstates the code path — but the mechanism it demonstrates is real.

**Decision: keep `bucket >`, and state the semantics.** The result now contains
only *whole* buckets, so the window is right-open at bucket granularity. The
difference from the pre-`F4.1` form is bounded by one bucket's contribution —
at most ~2% at the coarsest real pairing (48 h, 1 of 48 hourly buckets), ~0.6%
at 7 d, ~0.07% at 24 h. Weighting a partial bucket as a full one over-counts
energy, so this is the more defensible reading; and an aggregate **cannot**
reproduce the old number in general, because the sub-bucket sample filtering it
depended on is exactly what the aggregate discards by construction.

`assertEnergySummaryMatchesRaw` pins both halves: exact equality against the
*precisely equivalent* raw query (first bucket boundary after the cutoff), which
catches a reverted `bucket`→`time` or a mismatched level/`kwhFactor` pair; and a
**one-bucket ceiling** against the old form, so a larger movement fails rather
than hiding behind the documented change.

## Amendment 2 (2026-08-10) — four operational findings, three of them fixed

All four came out of the review round and none was known when the decisions
above were written.

**1. Future-dated readings park the watermarks ahead of `now()`. Fixed in the
backfill.** Measured: **714** `telemetry.point_values` rows carry `time >
now()`, persistently ~34 minutes ahead — a constant offset, not clock skew
(container clocks agree to 2 s). `apps/ingest/src/host/normaliser.ts` takes the
device's `sample.at` with no future-horizon clamp. A `NULL, NULL` refresh
follows the *data*, not the clock, so the documented backfill parked all four
watermarks in the future, and for that whole span the real-time branch — the
entire point of decision 4 — covered nothing, leaving stored, understated
buckets with no error. `pnpm db:refresh-aggregates` now refreshes `NULL, now()`.
**The unclamped ingest timestamp is a separate defect and is not fixed here**;
it belongs with `F1.7`.

**2. A manual backfill can collide with a scheduled policy. Fixed.** Found by
rehearsing the script rather than reasoning about it: `55P03 — could not refresh
continuous aggregate "point_values_1h" due to a concurrent refresh`. The first
version had no retry, exited non-zero, and left `_1h`/`_1d` at `-infinity` while
`_1m`/`_5m` were done — a half-materialised chain from a command that looks
atomic. Now retried up to five times with a 3 s delay, and the session sets
`statement_timeout = 30min` / `lock_timeout = 30s` so a wedged refresh fails
instead of hanging.

**3. Recovery from a future-parked watermark is manual DDL, and it is not
optional knowledge.** A watermark only moves forward, and migration `0027` will
not re-run because Drizzle has recorded its hash. Recovery is: drop
`point_values_1d`, `_1h`, `_5m`, `_1m` (children first, `CASCADE`), re-apply
`0027`'s SQL by hand, then `pnpm db:refresh-aggregates`. Executed on the dev
database on 2026-08-10 to confirm it works; watermarks came back to `now()`.

**4. Rollback is two-part, not one.** Reverting `0027` on the pilot means
dropping the four views **and** reverting `apps/api` in the same window —
`dashboard.service.ts` interpolates `telemetry.point_values_1h`/`_1m`, so
dropping the views under a running API turns `energySummary` into a 500 on a
missing relation. Add deleting `__drizzle_migrations` id 27 if it must be
re-applied. "Additive DDL, forward-only" is true; "revertible by dropping four
views" was not the whole story.

Also verified in that round, and worth not re-deriving: the **fresh-database CI
path had never executed anywhere** (these commits are local; the base commit's
own run was red). Rehearsed on a scratch database — `db:migrate` → `db:seed` →
`db:refresh-aggregates` — and all four levels report `0 rows` and exit `0`, so
the nested-aggregate-over-empty-source case does not error. The **lock level**
`CREATE MATERIALIZED VIEW … WITH NO DATA` takes on `point_values` is still
**not** measured; treat this ADR's earlier "takes no lock beyond what it needs"
as unverified and rehearse against `pg_locks` before the pilot run. One
confirmed cost either way: from `0027` onward every `INSERT` into
`point_values` also writes an invalidation entry — small, permanent write
amplification on the ingest hot path.

## A deletion from raw does not delete it from the aggregates

Raised by the security review and **reproduced**: insert a row behind the
watermark, refresh, `DELETE` it from `telemetry.point_values`, and the aggregate
still returns it. No scheduled policy repairs it — the `start_offset` windows
never reach that far back.

This ADR's watermark section covers *arrivals*; the divergence is symmetric, and
the deletion direction is the one that matters. This repo's established
site-removal pattern **is** a raw delete —
`packages/db/drizzle/0014_remove_smoc_pretoria_north.sql` and
`0021_remove_onboarding_demo_locations.sql` both do it. Both predate the
aggregates, so nothing is wrong on disk today. But the next migration of that
shape, or any customer erasure request, leaves per-minute `sum`/`count`/`min`/
`max` per `(asset_id, point_key)` readable in four views indefinitely — and
decision 7 makes `_1h`/`_1d` the long-term record, which turns a lag into
permanence.

**Standing obligation, in the same class as ADR 0021 decision 6:** any deletion
from `telemetry.point_values` must be followed by
`refresh_continuous_aggregate('<level>', <range start>, <range end>)` for all
four levels, finest first. It is stated in `0027_continuous_aggregates.sql` as
well, because that is where the next author of such a migration will look, and
it is an explicit constraint on `F4.2`.

## Two behaviours found while building, both recorded rather than fixed

Neither was known when the decisions above were written. Both are properties of
how TimescaleDB serves a continuous aggregate, not defects in this
implementation, and both change what a reader may assume.

### The watermark, and late arrivals behind it

A continuous aggregate serves any bucket **behind its watermark** from stored
rows only; the real-time branch covers the region *ahead* of it. So a row
inserted for a bucket behind the watermark is **invisible to aggregate reads
until a refresh covers that range** — `materialized_only = false` does not help,
because that flag governs the tail, not the past.

Measured 2026-08-10: the watermark can also sit **ahead of `now()`** — `_1m` at
07:54 with `now()` at 07:20, `_1d` at the following midnight — so "recent" is
not a safe proxy for "live". The first version of the equality suite failed with
`0 aggregate buckets vs 240 raw` for exactly this reason, and the suite now
derives its fixture window from the watermarks.

**Why it matters beyond tests.** ADR 0007's MQTT path gives no ordering
guarantee. A reading that arrives late is picked up by the next scheduled
refresh **only if it falls inside `start_offset`** — 3 h for `_1m`, 12 h for
`_5m`, 3 d for `_1h`, 30 d for `_1d`. Anything later than that is permanently
absent from aggregate reads until someone runs `pnpm db:refresh-aggregates`,
while remaining present in raw `point_values`. That is a divergence between two
views of the same data, with no error and no alarm — the `F1.1` `notify=off`
shape again. The `start_offset` values in decision 5 are the actual tolerance
for late data, which is a stronger claim than "generous on purpose"; treat
changing them as changing a data-completeness guarantee.

### `_1d` is only final for completed days

A full backfill leaves `_1d`'s watermark at the end of the **current** day
bucket, so today's partial bucket is served from stored rows — frozen at its
backfill-time value — and `_1d`'s refresh policy (`end_offset` 2 days) will not
revisit it for two days. The invariant floor from decision 3 is 1 d 2 h, so no
setting of `end_offset` makes the current day self-correcting.

This is **not** worth engineering around: a daily energy series should not
report a partial day as if it were a day. But it must be stated, because
decision 7 makes `_1d` the long-term record and a future reader could reasonably
assume it answers "today". It does not, and `F3.5`'s scheduled reports and
`F4.28` both need to know that. Read `_1h` for anything inside the current day.

## Promotion follow-ups (AGENTS.md §10, owed separately)

Not in the feature PR — §9.10 puts rulebook edits in their own `chore(agents):`
change and §10.1 allows one promotion per PR:

- **AGENTS.md** — status line gains ADR 0023; `AGENTS.md:159` ("raw SQL for one
  Timescale hypertable") becomes the hypertable *and its aggregates*; §2 gains a
  *Telemetry aggregates* row naming the four views, the no-`avg_value` rule and
  the `materialized_only = false` requirement; §6's line on scale/retention
  softens for aggregates only, **not** for retention, which is still `F4.2`.
  Also owed on §4.7's neighbours rather than §4.7 itself: the aggregates carry
  **no tenancy column** and no scope predicate, exactly like `bms.audit_log` in
  ADR 0021 — but unlike it they are only ever read *through* already-scoped
  service methods, never by a route of their own. That is a property worth
  stating so nobody exposes an aggregate endpoint assuming it is scoped.
- **`docs/roadmap.md`** — mirror `F4.1` per §10 step 4.
- **`docs/BACKLOG.md`** — `F4.1` to `✅` only on passing tests, recording that
  `F4.2` is thereby unblocked and constrained by decision 7. Plus the
  stale-numbering correction to the `E5.1` row noted under Status. The new
  `F4.28` row is scope addition, not a promotion, so it lands with this feature
  rather than in the `chore(agents):` sweep.
- **Separate, not a promotion:** the one-line `docker-compose.yml` pin from
  decision 4.
