# ADR 0024 — Telemetry compression and retention (`F4.2`)

## Status

**Accepted (2026-08-10).** Backlog item `F4.2` (Wave 0, P0, effort "incl."),
unblocked the same day by `F4.1` / ADR 0023. Accepted by the repo owner at the
AGENTS.md §10 gate.

**The draft opened three questions and the gate closed one.** The other two were
closed by measuring rather than by deciding, and both closed *against* the
draft's own recommendation: facts 13–15 replaced the proposed `_1m`/`_5m` ladder
(decisions 3 and 4) and withdrew the proposed level selector (decision 8). The
gate settled the one that measurement could not — `drop_after = 2 years`,
confirmed. Under decision 4 it governs raw at **730 days** and the two fine
aggregate levels at **735**: the five-day margin is required rather than
cosmetic, because equal horizons still let the two independent policy schedules
produce the forbidden state briefly.

**One question is routed outward rather than answered here:** whether any Ion
Exchange compliance obligation needs sample-level effluent data beyond two
years. It belongs in the client email already owed for `E5.1`, and the two-year
fuse means nothing is at risk before it is answered — see
[Open at the gate](#open-at-the-gate).

`0020` stays reserved for the E8.1 encryption-at-rest retro. `0021` went to
`F4.14`, `0022` to `E8.3` and `0023` to `F4.1`, so this ADR takes **`0024`**.
`BACKLOG.md:344`'s `E5.1` row still says that item's ADR "would be **0022**",
which was true when written and is now wrong twice over; ADR 0023 recorded the
same staleness and it is still owed as a one-line correction to that row.

## Context

`telemetry.point_values` has been a hypertable since ADR 0001 with
`chunk_time_interval = 1 day` and **no compression and no retention** — 14
chunks, none compressed, growing without bound. ADR 0023 added four continuous
aggregates over it and deliberately left both to this item.

Two things make this more than "add two policies".

**`docs/AGENTS.production.md:145` already asserts these as implemented** —
`compress_after = 7 days`, `drop_after = 2 years`, "per-tenant override
allowed". That has been documentation of an intention presented as a fact. This
ADR is what makes it true, and the reconciliation of that file is part of the
promotion sweep rather than an afterthought.

**ADR 0023 decision 7 already bound part of this decision**, and is inherited
verbatim: `F4.2` may compress any level and may drop raw, but may **not** drop
`_1h` or `_1d` without its own decision, because `drop_after` on raw makes the
aggregates the only long-term record and `_1d` alone cannot answer "the peak
hour in March two years ago" — the resolution ISO 50001 baselining (`F4.19`)
and the `E4.x` analytics need. Retaining both costs ~0.5% of raw.

### Measured facts

All measured 2026-08-10 on the pilot database — TimescaleDB **2.29.1** /
PostgreSQL 16.14, 625,159 raw rows over ~5 days, 14 chunks. Every destructive
test ran against **throwaway probe relations** (`telemetry.f42_probe`,
`telemetry.f42_real`, dropped afterwards; production verified intact after:
four aggregates, `materialized_only = f`, all four refresh jobs `Success`).
That is not caution for its own sake — my first `F4.1` suite permanently
ratcheted production watermarks forward before a review caught it.

**1. Compression works on this table's exact shape, and the honest ratio is two
numbers, not one.** With `compress_segmentby = 'asset_id, point_key'` and
`compress_orderby = 'time DESC'`, on one real day (2026-08-09, **425,235**
rows):

| | Before | After | Ratio |
|---|---|---|---|
| heap | 33 MB | 544 kB | **62.1×** |
| indexes | 79 MB | 72 kB | — |
| **total** | **112 MB** | **3944 kB** | **29.1×** |

The 62× is what the data does; the 29× is what the disk sees. They differ
because compressing a chunk **replaces its btrees** — and on an uncompressed
chunk the indexes are **2.4× the heap** (79 MB against 33 MB), so most of the
on-disk win is index elimination rather than column encoding. Quoting 29× as
"the compression ratio" would be the same error `F4.1` already made once by
comparing two different query shapes, so both figures are recorded.

A synthetic probe with `random()` values compressed only **9.6×**. The ratio is
data-dependent and the real-data figure is the one this ADR relies on. The
2026-08-09 chunk is also not bloated — 425,235 rows against 146,424 on 08-05,
proportionally the largest, checked before the figure was used.

**2. All of this DDL is transaction-safe, so it can be an ordinary migration.**
Unlike `F4.1`'s backfill, which could not be one. Inside a single `BEGIN`:
`ALTER TABLE … SET (timescaledb.compress …)`, `add_compression_policy()` and
`add_retention_policy()` all succeeded — and after `ROLLBACK` the probe had
**0** jobs, so they are genuinely transactional rather than merely tolerated.

**3. Use `add_compression_policy`, not `add_columnstore_policy`.** Both exist on
2.29.1, and they are not interchangeable: the former is a **function**, the
latter a **procedure** (`pg_proc.prokind = 'p'`) that needs `CALL`. Timescale
renamed compression to "columnstore" in 2.18 and the old name is the
compatibility alias — the same deprecation class as the real-time aggregation
ADR 0023 decision 4 depends on. Recorded as a watch item; not designed around.

**4. `compress_after 7d` does not break the ingest.** A plain `INSERT` of a new
row into a compressed chunk succeeds. So does the ingest's exact statement —
`ON CONFLICT (time, asset_id, point_key) DO UPDATE`
(`apps/ingest/src/host/normaliser.ts:203`) — against an existing row inside a
compressed chunk: the update lands (777 read back, one row at that key) and the
chunk **stays compressed**.

**5. Refreshing an aggregate over a fully compressed range works, and is
exact.** 34,560 series-buckets compared per `(bucket, asset_id, point_key)`
against `date_trunc` over raw: **0** sum mismatches, 0 count mismatches, 0
min/max mismatches, worst sum error **0**.

*A first attempt reported "394 mismatches".* That was my comparison summing 12
series in a different order — floating-point non-associativity against exact
`IS DISTINCT FROM`, not a defect. It is recorded because a wrong number of that
shape is exactly the kind that gets quoted downstream.

**6. `drop_chunks` on raw leaves the aggregate rows intact.** 34,596 aggregate
rows before, **34,596 after**, every one bit-identical to a baseline snapshot,
with 27,566 raw rows gone. This is the property ADR 0023 decision 7 *assumes*
and nothing had verified. Retention on raw is safe by itself.

**7. But a refresh over a dropped range deletes them — 34,596 → 7,068 rows.**
This is the finding that makes `F4.2` more than a migration.

The 7,068 survivors are not a mystery: `drop_chunks` only drops chunks
*entirely* older than the cutoff, so the chunk straddling the 99-day boundary
was correctly left in place and the refresh recomputed its rows intact.
Everything in the fully-dropped chunks was removed, because a refresh
recomputes from raw and raw is now empty there.

**`pnpm db:refresh-aggregates` refreshes `NULL → now()` — the entire
history.** It was shipped by `F4.1`, is wired into CI, and is documented as the
operator's recovery tool. The moment `drop_after` has run once, running it
destroys precisely the long-term record ADR 0023 decision 7 exists to protect.

**8. The scheduled policies cannot trigger fact 7.** `start_offset` is
3 h / 12 h / 3 d / 30 d against a `drop_after` of 2 years, so the automatic path
never looks back far enough. Only the manual/CI script can. That is what makes
fact 7 a footgun with a manual in front of it rather than a live bug.

**9. Compression does not regress the reads that stay on raw.** This is
deliberately *not* offered as a speed-up. The hourly-rollup shape ran 20–24 ms
on a compressed copy against 29–86 ms on the original, but those are different
relations with different indexes and cache states, so the only supportable
claim is "not catastrophically slower" — and nothing here depends on more than
that. The honest cost is the single-point read: **2.3 ms → 5.9 ms**, a
consequence of the index elimination in fact 1, on the path
(`telemetry.service.ts`) that reads recent, uncompressed data anyway.

**10. Every aggregate level can be compressed and can carry its own retention
policy.** `add_retention_policy('telemetry.…_1m', …)` returns a job id.
`ALTER MATERIALIZED VIEW … SET (timescaledb.compress = true)` works with
`materialized_only = false` left intact.

**Two measurements, and the settings decide which applies** — labelled because
the first was taken on defaults and the migration does not ship defaults, which
is exactly the unlabelled-figure error ADR 0023 had to correct once already:

| `_1m` over real pilot data | heap | total |
|---|---|---|
| **defaults** (`compress_orderby = bucket,asset_id,point_key`, no segmentby) | 7464 kB → 160 kB (46.7×) | 12 MB → 2072 kB (**5.84×**) |
| **as shipped** (`segmentby = asset_id, point_key`, `orderby = bucket DESC`) | 7592 kB → 288 kB (26.4×) | 12 MB → 1640 kB (**7.51×**) |

**The shipped settings compress the heap roughly half as well and the total
better**, which is not a contradiction: `segmentby` splits the data into more,
smaller per-series batches — less runway for the column encoders — while
shrinking the index that dominates the total. `7.51×` is the figure decision 4's
storage numbers derive from, because it is the configuration that ships.

Either way an aggregate compresses far worse than raw's 29×, because it **keeps**
its indexes where a raw chunk loses them. Reads stayed exact after compression
under both settings (13.326461 kW aggregate and raw, on the shipped ones).

**11. Nothing can read `_1m` older than 47 hours, and nothing reads `_5m` at
all.** This is what the retention ladder actually turns on, so it was
enumerated rather than assumed:

| Site | Bucket | Window shape | Level after `F4.28` |
|---|---|---|---|
| `dashboard.service.ts:639` (`energySummary`) | min/hour | trailing, ≤168 h | `_1m` (<48 h) / `_1h` |
| `dashboard.service.ts:471` | minute | trailing | `_1m` |
| `dashboard.service.ts:701` (`energySourceMix`) | min/hour | trailing, ≤168 h | `_1m` (<48 h) / `_1h` |
| `dashboard.service.ts:782` | bare `avg` | trailing, m/h suffix | `_1m` |
| `reports.service.ts:133`, `:180`, `:233` | hour / bare `avg` | **explicit `start`/`end`** | `_1h` |

`parseEnergyWindow` caps at 168 hours and selects minute buckets only when the
<!-- Amendment 3 fact 28: the cap is 720 hours, not 168 — `1-168h` OR `1-30d`. The
     47-hour claim is still right, but because `useHourlyBuckets` routes everything
     >= 48 h to `_1h`, not because windows are short. -->
window is **< 48 h**; every dashboard window is trailing (`bucket > now() -
$1::interval`). The three `reports.service.ts` sites do take a caller-supplied
`start`/`end` with **no lower bound** on how far back `start` may reach — only a
31-day cap on duration — but all three bucket by `hour`, so `F4.28` lands them
on `_1h`, which decision 7 already protects.

So the ladder is not constrained by any read that exists or is planned. It is
constrained by an **invisible coupling to a 168-hour cap** in a different file.

**12. Current sizes, and a wrinkle retention will not fix.** Over ~5 days: raw
**175 MB**, `_1m` 14 MB, `_5m` 2992 kB, `_1h` 528 kB, `_1d` 304 kB. Also
present: **seven empty chunks in the future** (2026-08-12 → 2026-08-24) and one
at **2020-01-01**, ~1152 kB of index overhead each, from test fixtures and the
unclamped ingest `sample.at` that ADR 0023 recorded and deferred to `F1.7`.
Retention drops only chunks *older* than its cutoff, so `drop_after` will
collect the 2020 chunk and will **never** collect the seven future ones.

**13. Dropping an aggregate's oldest chunks makes that range read as *empty*,
with raw fully intact.** Retention drops only chunks older than its cutoff, so
the watermark stays high (measured: unchanged at 2026-08-10 10:12) and the
dropped range is *behind* it — served from stored rows only, which are now gone.
Reading 2026-08-05 from `_1m` after dropping that one chunk returned **0 rows**
while raw still held **146,424** rows for the same period. Not slow, not
approximate: zero, silently.

**14. And a refresh cannot rebuild it.** `refresh_continuous_aggregate` over
exactly that range, with raw complete, reported *"already up-to-date"* and left
**0** rows. The range is behind the watermark and the invalidation log is empty,
so the shipped refresh call has nothing to act on. Repair means dropping and
recreating the aggregate and re-materialising from scratch — not an operation
any script here has. **Aggregate retention is therefore irreversible in
practice, even while its source data still exists.**

**15. The reason fact 13 had to be measured on a partial drop — and a
conclusion I got wrong first.** Dropping *all* of an aggregate's chunks resets
the watermark to `-infinity` (measured: 4714-11-24 BC), which puts the whole
range *ahead* of it and hands reads to the real-time branch: **correct answers,
at raw prices** — 644 ms for a one-day range. I measured that case first and
concluded aggregate retention was benign and self-healing. It is not; the
full-drop case is the misleading one, and no retention policy ever produces it.
The partial drop is what a policy actually does, and it is fact 13.

## Decision

1. **Migration `0028_compression_retention.sql`** (journal idx 28), forward-only
   and additive, carrying all the policy DDL. Transaction-safe per fact 2.

   **No `compress_chunk` call in the migration.** Compressing whatever old chunks
   exist is left to each policy's first scheduled run — the count is not fixed,
   it depends on when the migration is applied and what history is present
   (on the dev database it was two compressed and a third dropped by retention;
   Amendment 1 fact 19).
   `compress_chunk` inside a transaction is **untested** — fact 2 covers the
   `ALTER` and the two policy functions, not that — and this ADR states it as
   untested rather than implying it is safe.

2. **Raw `telemetry.point_values`: `compress_after = 7 days`,
   `drop_after = 2 years`**, with
   `compress_segmentby = 'asset_id, point_key'`, `compress_orderby = 'time
   DESC'`. The segmentby choice is what makes fact 1's 62× possible: it groups
   each series so values are delta-encoded against their own neighbours.

3. **The governing rule, which facts 13–15 forced and which replaces an earlier
   draft of decisions 3 and 4:**

   > **A level derivable from raw lives exactly as long as raw. A level that
   > outlives raw is never dropped.**

   An earlier draft of this ADR recommended `_1m` at 90 days and `_5m` at 400
   days, reasoning that `_1m`'s read reach is 47 hours (fact 11) so a shorter
   horizon was free, and that anything still backed by raw could be rebuilt.
   **Both halves were wrong.** Fact 13: a dropped aggregate range reads as
   **empty**, not as a slow fallback to raw. Fact 14: it **cannot be rebuilt**
   by any refresh, with raw fully present. A horizon shorter than raw's would
   therefore create a window — 90 days to 2 years — in which raw holds the data,
   the aggregate silently returns nothing, and no shipped tool can repair it.

4. **`_1m` and `_5m`: compress after 7 days, `drop_after = 735 days` — raw's 730
   plus a five-day margin.** This is decision 3 applied, and the margin is the
   part that matters.

   **Not the same 730 as raw, and not "the same horizon" loosely.** Equal
   horizons would still produce the forbidden state — raw holding a period its
   aggregate does not — because the two policies run on **independent schedules**
   and either may fire first. The window would be hours rather than years, but
   facts 13 and 14 make even a transient occurrence unreadable *and*
   unrepairable. Strictly greater is the invariant; 735 is the smallest round
   margin that satisfies it, and the surviving direction (aggregate briefly
   outlives raw) is the safe one — it is what `_1h` and `_1d` do permanently.

   The five days are scheduling margin, not a meaningful retention figure.
   Both test layers enforce the *inequality*, not the constant.

   It bounds both levels at roughly **272 MB and 57 MB** compressed
   steady-state at pilot volume (from fact 10's shipped-settings 7.51×), against
   ~1.0 GB/year and ~213 MB/year growing without limit uncompressed.

5. **`_1h` and `_1d`: no retention policy, and not compressed.** ADR 0023
   decision 7 forbids dropping them and this ADR does not overturn it. They are
   also left as row-store deliberately: together ~60 MB/year, they are the
   historical report path (fact 11), and keeping them uncompressed keeps that
   path free of any decompression cost. Two more policies are not worth ~50 MB
   a year.

6. **`packages/db/src/refresh-aggregates.ts` gains a lower bound, and that is in
   scope here.** Not a follow-up. Fact 7 makes its current `NULL → now()`
   destructive from the first time `drop_after` runs, and shipping retention
   without this ships a documented tool that deletes the archive.

   **The bound is `min(range_start)` over raw's chunks — derived, not
   configured.** An earlier draft of this decision said "`now() - <horizon>`, the
   level's own retention horizon or raw's, whichever is shorter, and refuses to go
   earlier". That is a **second copy of the retention interval**, free to drift
   from the policy that actually governs it, and the shipped code argues against it
   in a comment. Raw's own chunk list cannot drift from raw, so the invariant is
   expressed once: *never refresh earlier than the oldest range raw can still
   account for.*

   It is the chunk boundary rather than `min(time)` deliberately — a chunk is the
   unit retention drops, so `range_start` is the earliest instant raw could still
   hold data for, and `min(time)` would sit later inside a live chunk and permit
   deleting aggregate rows for buckets raw may yet receive late arrivals into.

   There is also no "refuses to go earlier" branch, because with a derived bound
   there is no caller-supplied range to refuse: the script takes no window
   argument. On a database with no raw chunks at all it returns early rather than
   refreshing — a fresh install, where every aggregate is legitimately empty.

7. **A probe-based test pair proves fact 6 and fact 7, because CI cannot.**
   `db:seed` inserts **zero** telemetry rows, so the `db:refresh-aggregates`
   step is a no-op in CI — the same reason ADR 0023 decision 5's justification
   was false, and the reason a green pipeline is not evidence here. A
   `.spec.ts`/`.test.ts` pair (§4.6) on **throwaway probe relations** asserts
   both halves: the aggregate survives a chunk drop, and an unbounded refresh
   destroys it. The second assertion is the one that fails if someone reverts
   decision 6.

8. **No retention-aware level selector, and this is a deliberate non-decision.**

   > **Superseded in its reasoning by Amendment 3 (fact 27).** The conclusion held
   > for this ADR's tree, where level choice was hard-coded per site. `F4.28` /
   > ADR 0025 built the selector, which makes the guard load-bearing; it lives in
   > ADR 0025 decision 1. The "168-hour cap" cited below is also wrong — see fact 28.

   An earlier draft made it decision 8, because facts 13 and 14 describe a real
   silent-failure class: a level whose data has been dropped returns *empty*, not
   an error. Decision 4 closes it at the source instead. With every fine level
   held for two years against a maximum `_1m` read reach of **47 hours**, the
   horizon exceeds the deepest reachable window by more than two orders of
   magnitude, and no widening of `parseEnergyWindow`'s 168-hour cap that anyone
   would plausibly make gets near it.

   The report path is not a counterexample even though its `start` is unbounded
   (fact 11): its 31 days is a cap on window *duration*, not on how far back the
   window may sit, so it can reach arbitrarily old data — and that is precisely
   why it buckets by hour and lands on `_1h`, which carries **no retention
   policy at all** under decision 5. The unbounded reach is safe because the
   level it reaches has no horizon, not because the reach is small.

   So a guard here would be a test for a gap the horizon already closed, plus
   dead code with one contrived caller. `point-aggregates.ts` still owes the
   level selector its own module comment claims ("level selection is a
   judgement… it should be made once" — no such function exists, and
   `energySummary` picks its level inline), but that debt is about **level
   choice** and belongs to `F4.28`, which has six sites to route through it. It
   is not a retention-safety mechanism and this ADR should not pretend it is.

## Open at the gate

**Two of the three questions this ADR opened were closed by measurement rather
than by judgement, and are recorded above rather than here.** The `_1m`/`_5m`
ladder (was A) is settled by facts 13–15: a shorter horizon than raw's opens an
irreparable window, so decision 4 ties them to raw. The level selector (was B)
is settled by decision 8 as unnecessary — the horizon closes the gap it would
have guarded.

**One question is genuinely open, and it is not an engineering one.**

**Confirm `drop_after = 2 years`.** It now sets the horizon for raw *and* for
`_1m`/`_5m` (decision 4), and it is **the only irreversible decision in this
ADR** — after two years `_1h` and `_1d` are the sole record of that period
(fact 6), at hourly resolution.

Three things bound the risk, and one does not:

- **Nothing can be dropped for ~2 years.** The oldest real row is 2026-08-05, so
  the policy is inert until 2028 on any data that exists. Changing the number
  later is `remove_retention_policy` + `add_retention_policy` — two statements,
  no migration, no downtime.
- Compression, which delivers essentially all of the disk saving (fact 1), is
  independent of this and fully reversible.
- What is *not* bounded: whether any Ion Exchange compliance obligation needs
  **sample-level** effluent or discharge data beyond two years. `_1h` satisfies
  ISO 50001 baselining and the `E4.x` analytics, but a regulator asking for
  individual readings is a different question and a business one. **It belongs in
  the client email already owed for `E5.1`** — not in this ADR, and not answered
  by me.

Given the two-year fuse, the recommendation is to take the number now and route
the compliance question to the client rather than hold the item.

## Dependencies

**None.** No npm package, so AGENTS.md §9.4 is not engaged. Compression and
retention policies are TimescaleDB Community features under the TSL, already
present in the pinned `2.29.1-pg16` image — no new licence surface.

## Consequences

- **Raw storage becomes bounded** where it was not: ~11.8 GB/year uncompressed
  (ADR 0023's figure, kept rather than re-derived so the two ADRs agree)
  → roughly 440 MB/year compressed (fact 1's total ratio), capped at two years.
- **A read regression on one path, accepted**: single-sample reads against
  compressed chunks cost ~2.5× more (fact 9). The affected sites read recent
  data, which is never compressed at a 7-day threshold.
- **Aggregate retention is irreversible, and that is now a property of the
  design rather than a hazard in it** (facts 13–14). Decision 4 makes the fine
  levels expire with their source, so the only way to reach the state where raw
  holds a period its aggregates do not is to run `drop_chunks` on a level by
  hand. Worth stating plainly because the natural assumption — "raw is still
  there, so I can rebuild it" — is false and fails quietly.
- **Two more scheduled jobs per policied relation, and they fail silently.** The
  same operational surface ADR 0023 flagged: verification is
  `timescaledb_information.job_stats.last_run_status = 'Success'` after the
  first window, not "the policy exists".
- **`docs/AGENTS.production.md:145` stops being an assertion about work that had
  not happened.** Its `compress_after`/`drop_after` line becomes accurate for
  raw; its "per-tenant override allowed" clause stays aspirational and should be
  marked as such rather than left reading as implemented.
- **Deferred, and named rather than left in prose**: the seven empty future
  chunks and the 2020-01-01 chunk (fact 12) are not cleaned up here — they are a
  symptom of the unclamped ingest `sample.at`, which ADR 0023 already routed to
  `F1.7`. Retention will never collect the future ones.
- **`compress_chunk` in a transaction stays unmeasured** (decision 1). The lock
  level of `ALTER TABLE … SET (timescaledb.compress)` was the other item in this
  bullet and is now measured — Amendment 1 fact 16, ACCESS EXCLUSIVE, 10.7 ms,
  bounded by `SET LOCAL lock_timeout` in the migration.
- **The compression path is only ever exercised on a database with history.** CI
  builds a fresh database every run, so no chunk reaches 7 days and no policy ever
  compresses anything there — a green pipeline says nothing about compressed-chunk
  behaviour. Amendment 1 fact 17 is a case in point: it was found by running the
  suite against a dev database where compression had already fired.

## Amendment 1 — measured while building, 2026-08-10

Four more facts, and one defect in another suite that this work uncovered. All
after the gate, none changing a decision — but three of them contradicted
something this ADR or its migration had assumed.

**16. `ALTER TABLE … SET (timescaledb.compress …)` takes an ACCESS EXCLUSIVE lock
on `telemetry.point_values`.** ADR 0023 recorded its own DDL's lock level as
unmeasured and asked for a `pg_locks` rehearsal before a pilot run; this is that
rehearsal, taken against the live dev stack with both the simulator and the MQTT
ingest writing. The strongest lock there is — it blocks reads as well as writes.

The work itself is catalog-only and took **10.7 ms**, so duration is not the
hazard; **acquisition** is, because the `ALTER` waits behind every in-flight
reader and blocks everyone arriving behind it. Migration `0028` therefore opens
with `SET LOCAL lock_timeout = '5s'`: if the lock cannot be had, the migration
fails and rolls back whole and is re-run at a quieter moment. A retryable failure
beats an unbounded stall on the hot telemetry path.

**17. `DELETE` from a compressed chunk works, and the chunk stays compressed.**
Fact 4 only covered writes (`INSERT` and the ingest's `ON CONFLICT … DO UPDATE`).
Deletes were never checked, and they turned out to be on the critical path: the
first compression run compressed the `2026-06-01` chunk, which is where the
`F4.1` suite's own fixture lives, and that suite's `cleanup()` deletes by
`point_key`. The whole suite passed against the compressed chunk and the chunk
was still compressed afterwards.

**CI could never have found this.** Its database is created fresh each run, so no
chunk is ever old enough for a 7-day compression policy to touch — the
compression path is only ever exercised on a database with history.

**18. The catalog lists continuous-aggregate policies under the *view* name, not
the materialization hypertable.** `timescaledb_information.jobs` reports
`telemetry.point_values_1m`, not `_timescaledb_internal._materialized_hypertable_18`
— for refresh, compression and retention policies alike. The first version of
`aggregate-retention.integration.spec.ts` resolved the materialization name and
looked policies up under that, which matched nothing. It would have failed
*safely* here (every lookup returned `undefined`, which the assertions treat as
"no policy") but the failure would have read as "migration 0028 did not take
effect" rather than "this query is wrong". The suite now asserts the catalog
shape itself first, so a future rename surfaces as its own failure instead of
making every other assertion vacuous.

**19. ~~Retention and compression both fired on their first run.~~ CORRECTED —
one of the six new policies failed on its first run, and this fact asserted
otherwise.** See Amendment 2. What is accurate: on **raw**, retention dropped the
stale empty `2020-01-01` chunk immediately (older than 730 days) and left all
seven future-dated chunks in place, because `drop_after` only ever collects chunks
older than its cutoff; and compression compressed the two chunks past 7 days
(`2026-06-01`, `2026-07-01`), leaving the four recent ones alone. That much is
fact 12 confirmed. The claim about the *aggregate* policies was wrong.

**20. Decision 6's mechanism was reversed after drafting, and this ADR carried the
old text.** Caught by the 2026-08-10 compliance review, not by me. The draft
specified the bound as `now() - <horizon>`; what shipped derives it from raw's
chunk list, the shipped code argues against the draft's form in a comment, and
`tests/adr-0024-retention-bounds.test.ts` asserts the draft's form must *not*
appear. Decision 6 is now rewritten to the shipped mechanism.

Worth naming as its own fact rather than a silent edit: this ADR already recorded
two reversals of its own recommendations (facts 13–15, decision 8) and was
carrying a **third, unrecorded** one. An ADR that documents its corrections
selectively is the failure this repo keeps recording, and it is more likely
precisely in a document that has already corrected itself twice and reads as
scrupulous.

**21. `F4.2` removed CI's only execution of `refresh_continuous_aggregate`, and
the pipeline could not notice.** Also from the compliance review.

`db:seed` inserts zero telemetry rows, so a CI database has **no raw chunks** —
and decision 6's derived bound returns early in exactly that case. Before this
branch the CI step issued four no-op refreshes; after it, none. The shipped SQL
string was executed by nothing, so a bad cast or a typo in it would ship green,
and the step's stated justification — "an unexercised script rots" — had quietly
stopped applying to the statement that matters.

Fixed by inserting **one** row before the step. Not to make anything non-vacuous
— the suites own their fixtures — but so the statements execute at all. The
general lesson is the one ADR 0023 decision 5 already had to retract a version of:
a CI step that runs is not the same as a CI step that exercises anything.

### The defect this uncovered in `F4.1`'s suite

`point-aggregates.integration.test.ts` was **failing on `main`** before this
branch existed — measured at `9b86a0f`: `energySummary("24h").totalKwh` 134.66
against a raw query's 133.83. The failure message blames the
`bucket`-versus-`time` predicate of ADR 0023 Amendment 1, and that is not the
cause.

**On a database with accumulated history.** This does *not* contradict the `F4.1`
row's "CI green on the merge commit": a CI database is created fresh each run, so
the orphans described below have never existed there and the suite passes. The
defect only manifests where the suite has run before — a developer's stack, or
the pilot. That is worth stating precisely, because "red on `main`" and "CI green
on `main`" are both true of the same commit and the apparent contradiction is
what would otherwise get re-litigated later.

`assertEnergySummaryMatchesRaw` inserts a `point_key = 'kw'` fixture, **refreshes
the production `_1m`/`_5m`/`_1h` over it** so the comparison is not vacuous, and
then deletes it from raw in a `finally` — with no follow-up refresh. That is a
direct violation of the standing obligation ADR 0023 wrote into `0027`'s header
and into `AGENTS.md` §4.4, by the suite that introduced it.

Two orphaned buckets were found on the dev database: value exactly `50.0`,
`sample_count` 1 — the fixture's minute 0, where the per-minute count is a single
sample of `50 + 0 + 0`. One bucket at 50 kW over a `1/60` factor is **0.833
kWh**, the gap exactly.

It was self-poisoning rather than merely untidy, and **partly self-cleaning**,
which is why it took this long to surface: each run's own refresh over
`[base - 1h, now()]` recomputes those buckets against a raw table that is now
empty there and deletes them — fact 7 doing the right thing by accident. Only
orphans falling outside the *next* run's window survive, so failure depends on
the gap between runs. That is the intermittency profile that gets re-run rather
than diagnosed.

Fixed here in its own commit, following the `F4.1` precedent for a pre-existing
red on `main` (`typecheck:tests`, commit `a302d13`): the `finally` now refreshes
the three levels it materialised, finest first, and reports to stderr rather than
throwing — rethrowing from a `finally` would replace a real assertion failure
with a cleanup error, and swallowing silently would leave the orphans.

## Amendment 2 — the review round, 2026-08-10

Two reviews (`migration-reviewer`, `agents-compliance-reviewer`) found **one
data-loss path in shipped code**, **three false claims in this ADR**, and a
latent trap in the migration. All are corrected above and here. The pattern worth
naming: every one of them is in the *reasoning around* a measurement rather than
in a measurement itself, and this ADR's care with the measurements is probably
what made the surrounding prose feel already-checked.

**22. The bound was applied to the wrong relation for three of the four levels —
a real path to losing the permanent archive.**

Decision 6 bounds each refresh at "the oldest range raw can still account for",
and the first implementation computed **one** floor from `telemetry.point_values`
and applied it to all four levels. That is correct only for `_1m`. The ADR 0023
chain is hierarchical: `_5m` reads `_1m`, `_1h` reads `_5m`, `_1d` reads `_1h`.

The failure it permits is the one the bound exists to prevent. TimescaleDB policy
jobs fail and lag **individually** (fact 23 is a live instance), so raw's
retention can run while `_1m`'s does not. Raw's floor then sits *older* than
`_1m`'s data, refreshing `_5m` from raw's floor recomputes it over a range `_1m`
no longer covers, and fact 7 deletes those rows — then `_1h` from an emptied
`_5m`, then `_1d`. The last two are the forever-archive of ADR 0023 decision 7,
and fact 14 says nothing rebuilds them. The same cascade opens with no job failure
at all if anyone raises raw's `drop_after` — which this ADR advertises as "two
statements, no migration" — without raising the aggregates'.

Fixed: each level is bounded by **its own source's** oldest surviving chunk.
Aggregate sources resolve through `materialization_hypertable_name`, because a
continuous aggregate's *chunks* are catalogued under the materialization
hypertable while its *policies* are catalogued under the view name (fact 18) —
two different answers to "what is this relation called", and using the wrong one
returns NULL, which this bound would read as "the source is empty".

**It had not bitten yet, and only by luck of arithmetic.** Raw uses 1-day chunks
and the four materialization hypertables use **10-day** chunks (measured), so with
730/735-day retention the aggregates' effective floor sits ~14 days older than
raw's — a margin that masks the bug in steady state. The real dev database
already shows the divergence the bug needs (raw's oldest chunk `2026-06-01`
against `_1m`'s `2026-08-05`), and the only reason nothing was lost is that raw
holds **zero rows** before `2026-08-05` — those June and July chunks are empty
leftovers from deleted test fixtures.

**Why no test caught it, which matters more than the bug.** The probe ladder was
raw → `_1m` — exactly the one level where the shipped bound was correct. A
single-level probe cannot express a cascade. The suite now builds
`f42_probe_5m` over `f42_probe_1m` and `assertPerLevelFloorProtectsTheCascade`
drops the fine level's old chunk while raw still holds the range, then asserts
both halves: the source's own floor preserves `_5m`, and **raw's floor destroys
it**. The static guard also now requires each level to declare its own source.

**23. Fact 19 was false: the `_5m` compression policy failed on its first run,
and the cause is a stack misconfiguration this ADR's own Consequences predicted.**

```
job_id 1016 | policy_compression | _materialized_hypertable_19 (_5m)
  last_run_status = Failed, last_successful_finish = -infinity, total_failures = 1
  XX000: failed to start job Job 1016 ("Columnstore Policy [1016]")
```

Four sibling jobs succeeded in the same instant (`10:25:57`). The image ships
`timescaledb.max_background_workers = 16` while PostgreSQL's own
`max_worker_processes` stays at its default **8**, so the worker budget cannot
supply the workers TimescaleDB is configured to start — and migration `0028` took
the policy count from 6 to **12**, which is what made a latent shortfall bite.

`CALL run_job(1016)` succeeds with no error, so the policy body was never the
problem; it was worker starvation. Nothing was actually lost either way — the
aggregates' 10-day chunks are not yet old enough for a 7-day threshold, so both
job 1016's failure and job 1014's "Success" compressed exactly nothing.

Fixed in `docker-compose.yml` with `-c max_worker_processes=24`, verified applied
(`SHOW max_worker_processes` → 24, 626,923 rows intact across the restart). 24
rather than 16 because that setting is also shared with parallel query and
logical replication. **What this does not prove:** that concurrent scheduled runs
never starve again — that needs a scheduled window, not a forced run. The
verification that matters operationally remains per-job `job_stats`, which is
precisely what the Consequences section said and what I then failed to do before
asserting fact 19.

**24. Refreshing across a compressed aggregate chunk works, including when it
must write.** The migration claimed this "does not need to be measured at these
margins". That reasoning covered the *scheduled* policies (`start_offset` 3 h and
12 h against a 7-day threshold) and **not** `pnpm db:refresh-aggregates`, which
spans the whole retained range and will cross compressed aggregate chunks from
about 2026-08-22 on this database — i.e. the operator's documented recovery tool
was about to start taking an untested path.

Measured on a probe with the shipped compression settings: a refresh across a
compressed aggregate chunk returns no error, leaves the data exact (2,881 rows,
sum 339,958.000 before and after) and leaves the chunk **compressed**. Forcing a
write — a new raw row inside the compressed range — updated the aggregate
correctly (`sum_value` 100 → 5100, `sample_count` 1 → 2) with the chunk still
compressed. Neither feared outcome occurs: no error, and no wholesale
decompression.

**25. `SET LOCAL lock_timeout` was justified backwards, and the guard encoded the
error.** The comment said `SET LOCAL` "cannot leak into the session that Drizzle's
migrator reuses for later files". Drizzle wraps **the whole run** in one
transaction — `session.transaction()` opens outside the migration loop — so
`SET LOCAL` reaches every migration applied after this one in the same run.
`0028` is last today, so nothing is broken; the first migration added after it
would have silently inherited a 5-second `lock_timeout` on fresh-database runs
(CI, a new dev machine) but not on incremental applies to the pilot — an
environment-dependent trap. The file now resets it before ending, the guard
asserts the reset, and both comments state the real reason.

Same transaction scope corrects **fact 16**: the ACCESS EXCLUSIVE lock is held
until the transaction *commits*, so 10.7 ms is the blocking window only when
`0028` is applied alone. Shipped alongside later migrations, it is held for the
whole run.

**26. The Consequences bullet on compressed reads had the right conclusion and
the wrong reason.** It said the affected sites "read recent data, which is never
compressed at a 7-day threshold". Four production reads have **no time predicate
at all** — `dashboard.service.ts:46`, `:142`, `:413` and `map.service.ts:94` do
`DISTINCT ON (asset_id) … ORDER BY asset_id, time DESC` — so they fan out across
every chunk, compressed ones included.

The conclusion survives for a better reason, verified with `EXPLAIN (ANALYZE,
BUFFERS)`: each compressed chunk costs **1 buffer** through a `ColumnarScan` over
an auto-built index on `(asset_id, point_key, …)`, against **84–171 buffers** for
each uncompressed chunk. Compression makes those reads *cheaper*. The 2.3 → 5.9 ms
single-point figure in fact 9 stands for its own query shape and should not be
generalised to this one.

## Promotion follow-ups (AGENTS.md §10)

Owed in a **separate `chore(agents):` change** (§9.10), not bundled with the
feature, and per §10.1 for **this ADR alone**:

- AGENTS.md status line gains ADR 0024.

- **`AGENTS.md` §2, both rows — and this was missing from the list until the
  2026-08-10 compliance review added it.** `:159` (*Telemetry aggregates*)
  describes the four levels without a word about compression or retention, and §2
  is where an agent learns what the aggregates *are*; `:160` (*Migrations*) names
  the hypertable and its aggregates but not their policies. This is the **same
  omission class** the ADR 0023 review caught, already recorded at
  `docs/BACKLOG.md:602` — "the ADR's own follow-up list is incomplete… do not copy
  it verbatim". Twice in two consecutive ADRs is a pattern in how I write these
  lists, not bad luck: I route new rules to the section I was last editing (§4.4
  here) and forget the section that introduces the subject.
- **`AGENTS.md:265` (§4.4)** gains the per-level ladder beside
  `chunk_time_interval = 1 day`, and the decision 6 bound on refresh range.

- **`AGENTS.md:271`–`275` (§4.4) becomes unsafe as written and must be
  qualified.** That rule was added yesterday by the ADR 0023 sweep and says,
  unconditionally: *follow any `DELETE` from `telemetry.point_values` with
  `refresh_continuous_aggregate` over the deleted range for all four levels.*
  It is correct today because raw is complete. Once `drop_after` runs it is a
  demolition instruction — over a range where raw has been dropped, that refresh
  is exactly fact 7, and the aggregate rows it deletes are the only record of
  that period. The qualifier is the distinction the rule currently lacks:
  refresh only where raw still holds the range; where it does not, the aggregate
  **is** the archive and must not be refreshed. This is the sharpest example of
  why decision 6 is in scope — the same mechanism reaches the archive through
  three doors (the script, a policy, and a documented rule in the rulebook), and
  ADR 0023's sweep shut none of them because retention did not exist yet.

- **`docs/AGENTS.production.md:145` (its own §4.5)** — a *different* file from
  `AGENTS.md`, not §9.10-gated, and the place where `compress_after = 7 days` /
  `drop_after = 2 years` / "per-tenant override allowed" have been asserted as
  implemented. The first two become true here; the third does not, and should be
  marked aspirational rather than left reading as shipped.
- **§6** was searched during the ADR 0023 sweep and has **no** aggregates,
  retention, compression or scale line — so, as with ADR 0023, there is expected
  to be nothing to soften. Verify rather than assume, and record the absence
  rather than adding a line in order to soften it.
- `docs/roadmap.md` gains an `F4.2` section; `docs/BACKLOG.md` flips the row and
  the §1 / §1b / §3 Mermaid / §5 markers.
- `docs/client-requirements-as-is-report.md:191` ("Retention, compression,
  aggregates" listed as the gap) and `:386` (row **A6**) close out.

- `docs/platform-assessment-consolidated.md` — **three lines, and "row A6" is not
  one of them.** `A6` is the label used in the *client-requirements* doc above; the
  assessment doc has no such row, so a sweep following the earlier draft of this
  list would have found nothing and moved on. The real targets are `:291` and
  `:450` (both "Timescale retention + aggregates" as outstanding effort) and —
  the one that matters most — **`:431`, the risk register**: "Disk growth (no TS
  retention) | Production outage | Retention policy in Phase A". That risk is
  retired by this ADR, and a stale *risk* line is worse than a stale effort
  estimate.

## Amendment 3 — decision 8's rationale did not survive `F4.28`, 2026-08-10

Two more facts, both corrections to this ADR rather than new measurements, and
both surfaced by **`F4.28` / ADR 0025** — the item this ADR handed the level-selector
debt to. Neither changes what migration `0028` shipped. The first invalidates a
*reason* while leaving its *conclusion* standing; the second names the wrong
mechanism as load-bearing, which is the more useful kind of error to fix.

Consistent with Amendment 2's observation, and now true a third time: every defect
here is in the reasoning *around* a measurement, not in a measurement.

**27. The selector decision 8 declined now exists, so the argument for declining it
no longer applies.**

Decision 8 refused a retention-aware level selector on the grounds that a guard
would be "a test for a gap the horizon already closed, plus dead code with one
contrived caller". That was **true of the tree this ADR reviewed**, and for a
reason it did not state: level choice was hard-coded at every call site, so there
was no single place where a wrong level could be chosen.

`F4.28` removes that property deliberately. ADR 0025 decision 1 builds
`levelForRange`, because six sites cannot each carry their own inline ternary — and
the obvious implementation is the duration-keyed one `energySummary` already had
(`useHourlyBuckets ? "1h" : "1m"`). Route the report path through *that* and a
24-hour range dated three years back selects `_1m`, which this ADR drops at 735
days, and facts 13 and 14 say the result is **0 rows, silently, and not rebuildable
by any refresh**. The guard this ADR called unnecessary becomes load-bearing the
moment the selector it deferred is written.

So decision 8's outcome stands for `0028` — no guard was needed in a tree without a
selector — and its reasoning is superseded. The guard lives in ADR 0025 decision 1:
a level is admissible only when `start >= now() - horizon(level)`, `end` plays no
part, and the horizons are held equal to this migration's `add_retention_policy`
intervals by a static test that **throws** rather than passing on any interval it
cannot parse.

**28. `parseEnergyWindow` does not cap at 168 hours — it caps at 720 — and the
conclusion survives on a different mechanism than the one this ADR credited.**

The figure appears four times here (fact 11's table twice, its prose, and decision
8) and is wrong every time. `parseEnergyWindow` accepts **either** `1–168h` **or**
`1–30d`; the day branch is the larger bound, so the deepest window a dashboard can
request is **720 hours**, already 4.3× the number this ADR reasoned from.

Decision 8's conclusion is unaffected, and it is worth being precise about why,
because this ADR credited the wrong thing. Fact 11's "nothing can read `_1m` older
than 47 hours" is **correct**, but not because windows are short — a 30-day window
is perfectly legal. It holds because `useHourlyBuckets` is `n >= 48` for hours and
**unconditionally true** for days, so every window at or beyond 48 hours is routed
to `_1h`, which has no horizon. `_1m` is reachable only by windows under 48 hours.

Which means fact 11's closing line — "the ladder is constrained by an **invisible
coupling to a 168-hour cap** in a different file" — names the wrong coupling. The
constraint is the **48-hour level switch**, not the window cap. The distinction
matters for exactly the change someone would think safe: raising the 48-hour
threshold widens `_1m`'s reach directly, while widening the window cap does not
touch it at all. Anyone protecting this ladder should watch `useHourlyBuckets`.

Both figures are left in place above rather than silently edited, with this
amendment as the correction of record — the same treatment fact 19 got in
Amendment 2, and for the same reason: a reader who finds the old number needs to
find the correction beside it, not a clean document that was never wrong.
