# ADR 0024 — Telemetry compression and retention (`F4.2`)

## Status

**Proposed (2026-08-10).** Backlog item `F4.2` (Wave 0, P0, effort "incl."),
unblocked the same day by `F4.1` / ADR 0023. Awaiting the repo owner at the
AGENTS.md §10 gate.

**Three points are open at the gate** and each changes a decision rather than
confirming it — they are listed under [Open at the gate](#open-at-the-gate)
below, and decisions 3, 4 and 8 are written as recommendations pending them.

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
`materialized_only = false` left intact, defaulting `compress_orderby` to
`bucket,asset_id,point_key`. A compressed `_1m` over real data: heap 7464 kB →
160 kB (46.7×), **total 12 MB → 2072 kB (5.84×)** — far worse than raw's 29×
because an aggregate **keeps** its indexes where a raw chunk loses them. Reads
stayed exact after compression (13.329768 kW both sides).

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

## Decision

1. **Migration `0028_compression_retention.sql`** (journal idx 28), forward-only
   and additive, carrying all the policy DDL. Transaction-safe per fact 2.

   **No `compress_chunk` call in the migration.** Compressing the three
   existing old chunks is left to each policy's first scheduled run.
   `compress_chunk` inside a transaction is **untested** — fact 2 covers the
   `ALTER` and the two policy functions, not that — and this ADR states it as
   untested rather than implying it is safe.

2. **Raw `telemetry.point_values`: `compress_after = 7 days`,
   `drop_after = 2 years`**, with
   `compress_segmentby = 'asset_id, point_key'`, `compress_orderby = 'time
   DESC'`. The segmentby choice is what makes fact 1's 62× possible: it groups
   each series so values are delta-encoded against their own neighbours.

3. *(Recommendation — open question A.)* **`_1m`: compress after 7 days, drop
   after 90 days.** Its reach is 47 hours (fact 11) and 90 days is ~46× that,
   so widening the dashboard cap even to 30 days stays inside it. It bounds
   `_1m` at roughly 43 MB compressed steady-state rather than ~175 MB/year
   growing forever, and storing minute resolution that no code path can request
   is not a saving worth keeping.

4. *(Recommendation — open question A.)* **`_5m`: compress after 30 days, drop
   after 400 days.** Thirteen months so a year-on-year comparison at 5-minute
   resolution is possible at all; ~40 MB steady state.

5. **`_1h` and `_1d`: no retention policy, and not compressed.** ADR 0023
   decision 7 forbids dropping them and this ADR does not overturn it. They are
   also left as row-store deliberately: together ~60 MB/year, they are the
   historical report path (fact 11), and keeping them uncompressed keeps that
   path free of any decompression cost. Two more policies are not worth ~50 MB
   a year.

6. **`packages/db/src/refresh-aggregates.ts` gains a lower bound, and that is in
   scope here.** Not a follow-up. Fact 7 makes its current `NULL → now()`
   destructive from the first time `drop_after` runs, and shipping retention
   without this ships a documented tool that deletes the archive. It refreshes
   from `now() - <horizon>` — the level's own retention horizon, or raw's,
   whichever is shorter — and refuses to go earlier.

7. **A probe-based test pair proves fact 6 and fact 7, because CI cannot.**
   `db:seed` inserts **zero** telemetry rows, so the `db:refresh-aggregates`
   step is a no-op in CI — the same reason ADR 0023 decision 5's justification
   was false, and the reason a green pipeline is not evidence here. A
   `.spec.ts`/`.test.ts` pair (§4.6) on **throwaway probe relations** asserts
   both halves: the aggregate survives a chunk drop, and an unbounded refresh
   destroys it. The second assertion is the one that fails if someone reverts
   decision 6.

8. *(Recommendation — open question B.)* **`point-aggregates.ts` gains the
   retention-aware level selector its own module comment already claims.** That
   comment says "level selection is a judgement… and it should be made once";
   there is no such function today, and `energySummary` picks its level inline.
   Retention creates a new silent-failure class — a level whose data has been
   dropped returns *empty*, not an error — so the selector must never return a
   level whose horizon does not cover the requested window. Small: a horizon map
   and one function, with the coupling in fact 11 made explicit and testable
   instead of left as a comment in a different file.

## Open at the gate

**A. The `_1m`/`_5m` ladder: drop them, or keep every level forever and only
compress?** Decisions 3 and 4 recommend dropping. The alternative is defensible
and the numbers are measured: compress-only leaves `_1m` at ~175 MB/year and
`_5m` at ~37 MB/year growing without bound, and in exchange the ladder becomes
trivial, decision 7's "must outlive raw" extends to all four levels, and the
silent-empty-read class in decision 8 never exists. Against it: `_1m` beyond 47
hours is unreadable by any current or planned site, so that is storage nothing
can query.

**B. Is decision 8 (the selector) `F4.2`'s or `F4.28`'s?** It is `F4.2` that
creates the failure mode, which argues for here. But `F4.28` is what converts
the six sites that would use it, which argues for there. Doing it here means a
guard with one caller; doing it there means retention ships with the coupling
still implicit.

**C. Confirm `drop_after = 2 years` on raw.** After two years the aggregates are
the *only* record of that period (fact 6), and the one remaining way to lose it
is a raw `DELETE` followed by a refresh (fact 7 — the same mechanism, reachable
by hand). `docs/AGENTS.production.md:145` also allows a "per-tenant override",
which nothing implements and which this ADR does not add.

## Dependencies

**None.** No npm package, so AGENTS.md §9.4 is not engaged. Compression and
retention policies are TimescaleDB Community features under the TSL, already
present in the pinned `2.29.1-pg16` image — no new licence surface.

## Consequences

- **Raw storage becomes bounded** where it was not: ~12.8 GB/year uncompressed
  → roughly 440 MB/year compressed (fact 1's total ratio), capped at two years.
- **A read regression on one path, accepted**: single-sample reads against
  compressed chunks cost ~2.5× more (fact 9). The affected sites read recent
  data, which is never compressed at a 7-day threshold.
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
- **`compress_chunk` in a transaction stays unmeasured** (decision 1), as does
  the lock level `ALTER TABLE … SET (timescaledb.compress)` takes on a live
  `point_values` — the same class of unrehearsed lock ADR 0023 recorded for
  `CREATE MATERIALIZED VIEW … WITH NO DATA`. Rehearse against `pg_locks` before
  a pilot run.

## Promotion follow-ups (AGENTS.md §10)

Owed in a **separate `chore(agents):` change** (§9.10), not bundled with the
feature, and per §10.1 for **this ADR alone**:

- AGENTS.md status line gains ADR 0024.
- **`AGENTS.md` §4.4** — the `docs/AGENTS.production.md:145` bullet list
  (`compress_after`, `drop_after`, per-tenant override) is the canonical SQL
  rule set an agent reads before writing telemetry SQL, and it currently states
  the unimplemented as implemented. It gains the actual per-level ladder and the
  decision 6 bound on refresh range.
- **§6** was searched during the ADR 0023 sweep and has **no** aggregates,
  retention, compression or scale line — so, as with ADR 0023, there is expected
  to be nothing to soften. Verify rather than assume, and record the absence
  rather than adding a line in order to soften it.
- `docs/roadmap.md` gains an `F4.2` section; `docs/BACKLOG.md` flips the row and
  the §1 / §1b / §3 Mermaid / §5 markers.
- `docs/client-requirements-as-is-report.md:191` ("Retention, compression,
  aggregates" listed as the gap) and `:386`/`docs/platform-assessment-consolidated.md`
  row A6 close out.
