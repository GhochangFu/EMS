# ADR 0061 — Ingest records both the receive time and the device time (`F4.57`)

## Status

Accepted — 2026-09-10, by the repository owner, at `F4.57`'s start gate
(AGENTS.md §10 step 2). Three rulings, asked one at a time and recorded verbatim
in §Rulings. **Ruling 3 was asked twice**: the first form was not implementable
against this table's primary key, and §Rulings records the failed form rather
than only the answer, because the reason it failed is the constraint a later
reader most needs.

An ADR is owed because the row itself says so. `F4.57` reads: *"The decision is
a product call and is the owner's under §10, which is why this is a row and not
a fix in `F1.7`."* `F1.7` measured the problem across nine RTUs and deliberately
did not fix it.

## Context

### What the code does today

`parsePayload` (`apps/ingest/src/adapters/mqtt.ts:174-197`) takes the envelope's
`ts` verbatim. It rejects a non-finite number and a `Date` that is not finite,
and nothing else — a timestamp three hours wrong parses cleanly.

`resolveSamples` (`apps/ingest/src/host/normaliser.ts:255-265`) starts each row
at `receivedAt` and then lets the device timestamp win **unconditionally**
whenever it is a valid `Date`:

```ts
let time = receivedAt;
if (sample.at !== undefined) {
  if (sample.at instanceof Date && Number.isFinite(sample.at.getTime())) {
    time = sample.at;
  } else {
    counters.invalidTimestamp += 1;
  }
}
```

Nothing bounds a parseable-but-wrong value in either direction.

**`time` is not merely a column.** It is the primary key —
`primaryKey({ columns: [t.time, t.assetId, t.pointKey] })`,
`packages/db/src/schema/telemetry-schema.ts:44` — it is the `ON CONFLICT` target
of the upsert (`normaliser.ts:326`), and it is the in-batch dedupe key
(`normaliser.ts:290`). Those three facts are what shape every decision below.

### The skew F1.7 measured

Nine RTUs against a server at 11:41:46 UTC on 2026-08-22, all nine agreeing to
the second on a 60 s cadence (`docs/f1.7-fleet-probe.md`, and the `F4.57` row):

| RTU | Offset |
|---|---|
| `861736076128211` | **−3:02:36** |
| `861736076128245` | −0:21:34 |
| `868019069263896` | +0:08:11 |
| `861736076128187` | +0:10:15 |
| `861736076080040` | +0:11:48 |
| `861736076116638` | +0:12:53 |
| `861736076081915` | +0:15:30 |
| `861736076128260` | +0:17:38 |
| `861736076104923` | **+0:34:31** |

The spread is 3 h 37 m. It is stable per device and long-standing, not drift —
the pilot's +34:31 matches the ~34 min recorded on 2026-08-06.

### What is actually stored

Measured 2026-09-10 against the running stack, as `bms_fleet`:

| | |
|---|---|
| Rows in `telemetry.point_values` | **10,016,481** |
| Span | 2026-08-29 04:26:55Z → 2026-09-10 05:28:04Z |
| Future-dated (`time > now()`) | **1,806** |
| Worst future skew | **+00:36:52** |

The stored false-fresh damage is **0.018%** of the table. It does **not** resolve
itself: five enabled RTUs run +8:11 to +34:31 ahead and keep writing
future-dated rows until this change is deployed.

### The in-batch collision question, measured

Moving `time` to `receivedAt` gives every sample in one batch the same key
component, so the first thing to establish is whether samples for one
`(asset, point)` ever share a batch:

| Same-second groups holding more than one row | |
|---|---|
| All assets | 371,077 |
| On the 20 `telemetrySource = 'mqtt'` assets | **0** |
| On `catalog` (simulator) assets | 371,077 |

**Every collision is on the simulator path**, which writes directly and never
calls `resolveSamples`. Nothing on the ingest path collides today, across 20
assets over 12 days.

That is a measurement of the present fleet, not a property of the design.
`resolveSamples` is the shared normaliser for **every** adapter, and `F1.2`–
`F1.6` poll many registers per batch. The measurement says the change is safe to
ship now; it does not say the shape is safe for ever.

### F4.37's sink-side half

`readingTimestampMs` (`apps/web/src/lib/schematic-telemetry.ts:240-246`) already
clamps forward — `Math.min(parsed, nowMs)` — and its docblock says *"the whole
point of `F4.37` is that this client must be correct on its own."* `F4.37`
closed the sink side and named the ingest clamp as the residual it left open.

## Rulings

**Ruling 1 — record both times; do not clamp.** Asked which of the row's three
options ingest should apply. The owner ruled **(c)**: `time` becomes
`receivedAt`, and a new `device_time` column preserves what the RTU reported.

Declined: **(a)** a forward-only clamp, `min(deviceTs, receivedAt)`, which kills
the false-fresh half, matches `F4.37`'s existing client rule and costs no
schema change — but leaves a lagging device silently omitted by every
`time > now() - interval 'N'` query, which cost real time during the `F1.7`
build. And **(b)** substituting receive time above a skew bound, which fixes
both ends but discards the device's own ordering within a batch and needs a
bound nothing in the measurements suggests.

**Ruling 2 — the 10,016,481 rows already written are left alone.** Asked what
happens to existing data. The owner ruled: *leave them, and document the
boundary.*

Declined: backfilling `device_time = time`, which is correct for rows whose
device sent a `ts` and **wrong** for rows where `time` was already `receivedAt`,
with nothing stored to tell them apart — it would invent a device timestamp that
never existed. Deleting the 1,806 future-dated rows, which destroys real
readings while more arrive until deploy. And clamping them to
`min(time, now())`, which is a delete-and-reinsert on a hypertable primary key,
carries a collision risk, and buys 0.018% of the table.

**Ruling 3, first form — not implementable, and recorded because the reason
matters.** The question asked what the in-batch dedupe key should use once the
stored `time` is `receivedAt`, and the owner ruled *keep device time in the
dedupe key* — preserving the per-sample ordering ruling 1 valued when it
declined (b). **The building session then found that this cannot be built**, and
returned rather than implementing something the ruling did not mean:

The dedupe map exists to match the primary key. Its own comment
(`normaliser.ts:223-228`) says Postgres rejects an `ON CONFLICT DO UPDATE`
statement that would touch the same row twice, so a batch carrying two samples
for one `(time, asset, point)` *"would fail the whole INSERT"*. With `time` fixed
at `receivedAt`, two samples deduped on **device** time produce two rows whose
stored keys are identical. Both in one statement raises
`ON CONFLICT DO UPDATE command cannot affect row a second time` and rolls the
whole batch back; split across the 1000-row statement boundary, the second
silently updates the first. So the first form either breaks the write or
collapses the reading anyway, order-dependently. It preserves nothing.

Storing both readings would require `device_time` inside the primary key, which
changes what a row means for every reader and what `F4.1`'s four continuous
aggregates bucket. That is far larger than this row and was declined.

**Ruling 3, second form — dedupe on the stored key, and count the collapse.**
The owner ruled: the dedupe key matches the primary key exactly, and a collapse
is **attributed** rather than silent — it names the first `(assetId, pointKey)`
it discards, so the loss is visible to an operator instead of folded anonymously
into a count. This is what ruling 3's intent reduces to under the schema:
the reading cannot be kept, so the *fact of losing it* is what gets kept.

Declined: collapsing silently on `duplicateInBatch` alone, which is the smallest
diff and leaves the whole counter surface to `F3.16`.

## Decision

1. **`telemetry.point_values` gains a nullable `device_time timestamptz`** in
   migration `0069`. No default, no backfill, no index. **The primary key is
   unchanged** — `(time, asset_id, point_key)`.

2. **`time` is the receive time, always.** `resolveSamples` writes `receivedAt`
   into `time` for every row, unconditionally. A device timestamp never reaches
   `time` again.

3. **`device_time` carries what the device said**, stored unchanged and
   **unclamped** — including a value hours ahead or behind. That is the point of
   the lossless option: the skew stays measurable after the fact. Nothing reads
   the column yet. `F3.16` is where the distinction is consumed, as
   `mqtt.ts:171` already says.

4. **`device_time` is NULL in three cases, and NULL means "no trustworthy device
   time".**
   - Every row written before migration `0069` — ruling 2 leaves all 10,016,481
     of them NULL.
   - A payload carrying no `ts`, where `parsePayload` returns no `at`.
   - A payload whose `ts` is present but yields a non-finite number or an
     invalid `Date`.

   **A reader cannot tell the three apart from the column alone, and that is
   accepted rather than repaired.** All three mean the same thing to a consumer,
   and the alternative was ruling 2's declined backfill, which would have
   invented a device timestamp for rows that never had one.

5. **`counters.invalidTimestamp` keeps incrementing** in the third case, even
   though `time` no longer depends on `sample.at`. It now records *"the device
   sent a timestamp this host could not read"* — which is what it always meant,
   and is still worth counting once the value no longer steers `time`.

6. **The in-batch dedupe key is the stored key** — `(receivedAt, assetId,
   pointKey)` — so the normaliser's notion of uniqueness and Postgres's can
   never disagree. A collapse increments `duplicateInBatch` **and** records the
   first collapsed `(assetId, pointKey)` on the counters, so the host log can
   name it. `F4.57` supplies that datum; **`F3.16` owns the operator-facing
   surface** for it and every other counter, and this ADR does not build one.

7. **No API, no web, and no aggregate definition changes.**
   `dashboard.service.ts:455` (`kw_time > now() - interval '20 seconds'`) and
   `map.service.ts:102` (25 s) become correct **without being edited**, because
   the column they read now means what they always assumed it meant. `F4.1`'s
   four continuous aggregates bucket on `time` and start bucketing correctly for
   the same reason.

8. **`readingTimestampMs`'s clamp stays.** `F4.37`'s `Math.min(parsed, nowMs)`
   is not removed. Ingest stops producing what it defends against; the defence
   remains for every row written before `0069` and for any future writer that
   bypasses the normaliser.

## Consequences

- **The false-fresh window closes at deploy, not before.** Five RTUs keep
  writing rows up to 34 minutes ahead until `0069` and the new ingest image are
  live. Nothing in this ADR repairs a row already written.
- **`time` changes meaning at the `0069` boundary and no column marks it.** A
  query spanning 2026-09-10 reads device time on one side and receive time on
  the other, differing by up to 37 minutes for five RTUs. Ruling 2 accepted
  this; the boundary is the migration's own timestamp.
- **The never-online half is fixed, and `F1.7`'s exclusion becomes
  reversible.** `F1.7` held Mora Nodir Kuthi II (−3:02:36) and Bhutnirghat II
  (−0:21:34) out of the enabled set *because* they could never land inside a
  20 s or 25 s window. With `time` at receive time they can. Re-enabling them is
  **not** part of this row — it is an `ingest-enabled-set.ts` change with its own
  evidence bar, and `F4.58`'s absent-reading defect still applies to
  Bhutnirghat II's two dark registers.
- **A second in-batch reading for one point is now lost where it previously
  survived** — on the ingest path only, and measured at zero occurrences today.
  Decision 6 makes each loss attributable rather than anonymous, which is the
  most this schema allows without putting `device_time` in the primary key.
- **`F3.16` inherits one more thing to surface.** The attributed duplicate joins
  the six counters ADR 0056 decision 4 already assigned it.
- **The `device_time` column is written and never read.** That is deliberate and
  temporary, and it is the one thing in this ADR a later reader could mistake
  for dead code. It exists so the skew is recoverable from the data rather than
  only from this document.

## Verification this ADR expects

- **A device timestamp never reaches `time`.** An assertion feeds
  `resolveSamples` a sample whose `at` is hours from `receivedAt` and pins
  `row.time === receivedAt` **and** `row.deviceTime === sample.at`. A mutation
  restoring `time = sample.at` must redden *that* assertion, not merely a suite.
- **The upsert names `device_time`.** `buildUpsert` is exported so a test can
  read the SQL without a database; the parameter count per row moves from five
  to six and the ceiling comment (`MAX_ROWS_PER_STATEMENT`, 65535 bind
  parameters) must be re-derived rather than left stale.
- **The three NULL cases are each asserted**, so decision 4's claim is gated
  rather than only written: no `ts`, an unreadable `ts` (which must also
  increment `invalidTimestamp`), and — by construction, not by test — a
  pre-`0069` row.
- **A collapse is attributed.** Two in-batch samples for one `(asset, point)`
  yield one row, increment `duplicateInBatch`, and record that point. A mutation
  dropping the attribution must redden an assertion that names it.
- **Migration `0069` is idempotent and its journal `when` is `Date.now()`.**
  Applied to a database already carrying the column, it does nothing and does
  not fail.
- **Live, against the running stack**: after deploy, `SELECT count(*) FROM
  telemetry.point_values WHERE time > now()` stops growing, and rows written
  after the cutover carry a non-NULL `device_time`. **Derive each RTU's offset
  from `device_time - time` on the new rows themselves** and check the RTUs
  against each other's ordering — do **not** pin the assertion to §Context's
  2026-08-22 numbers. Those are 19 days old, "stable per device" is `F1.7`'s
  claim rather than a fresh measurement, and a device that has been re-synced
  since would fail a correct implementation.

## Amendment 1 — three corrections, recorded before any source moved (2026-09-10)

At `F4.57`'s build start, following ADR 0060 Amendment 1's precedent. **No
ruling changes.** Two of the three are defects in this ADR's own §Decision and
§Verification; the third is a measurement that confirms decision 7 and records
*why*, which the ADR asserted without evidence.

**1. The upsert's `DO UPDATE` must set `device_time`, and §Decision did not say
so.** `normaliser.ts:328` reads:

```sql
ON CONFLICT (time, asset_id, point_key) DO UPDATE
  SET value = EXCLUDED.value, unit = EXCLUDED.unit
```

A re-delivered reading therefore updates `value` and `unit` while keeping
whatever `device_time` the first delivery wrote. The column would silently stop
describing its own row — the exact failure this ADR exists to prevent, one
column over. **Decision 1 is extended**: the conflict clause also sets
`device_time = EXCLUDED.device_time`, and §Verification gains an assertion that
a second delivery carrying a different `ts` moves the stored `device_time`.

**2. `NotifyReading` is not widened, and it is declared twice.**

```
apps/api/src/admin/telemetry-entry/notify-chunk.ts:20
apps/ingest/src/host/chunk.ts:25
```

Two independent declarations of one wire shape, and the ingest one is what
`pg_notify` carries on `bms_telemetry` to the API's relay. Decision 7 says no
web work is owed, and that holds **only** if the notify payload is left alone.
`toNotifyReading` (`normaliser.ts:344`) must keep emitting exactly its five
existing fields. Adding `deviceTime` there would widen a shape in two apps and a
socket contract, for a column decision 3 says nothing reads yet.

Recorded as a §4.8 vocabulary split found in passing and **not** repaired here,
the way ADR 0060 recorded `idParamSchema`'s duplicates.

**3. Decision 7's aggregate claim is now measured, and it holds for a reason the
ADR did not give.** The concern is real in general: moving `time` to
`receivedAt` makes new rows land *behind* wherever the continuous-aggregate
watermark sits, and a row below the watermark is invisible until a refresh
covers its bucket. Measured on the running stack at `now() = 2026-09-10
05:02:59Z`:

| Aggregate | Watermark | Policy `start_offset` / `end_offset` |
|---|---|---|
| `point_values_1m` | 05:01:00 — **2 min behind** | 3 h / 1 min |
| `point_values_5m` | 04:50:00 — 13 min behind | 12 h / 10 min |
| `point_values_1h` | 02:00:00 — 3 h behind | 3 days / 2 h |
| `point_values_1d` | 2026-09-09 00:00 — > 1 day behind | 30 days / 2 days |

**No watermark is ahead of `now()`, and the 1,806 future-dated rows did not push
one there.** The `end_offset` bounds it: the 1m policy refreshes only to
`now − 1 min`, and its watermark sits exactly at that bucket. Future-dated rows
live *above* every watermark and are served by the live tail, because all four
aggregates are `materialized_only = false` — the union `telemetry-schema.ts:54`
already documents.

Two independent reasons the cutover is safe, so neither has to be trusted alone:
every `start_offset` (3 h, 12 h, 3 days, 30 days) reaches far behind the 37-
minute skew, so the boundary window is re-materialised on the next run either
way; and until it is, the live tail answers.

**`0069` therefore issues no `refresh_continuous_aggregate`.** That is
deliberate and is the safer choice on this stack: a manual refresh is what
leaves an orphaned `continuous_aggs_jobs_refresh_ranges` row when it is
interrupted, and one of those blocks every later refresh on that aggregate.

## Amendment 2 — a buffered sample's receive time is its original arrival (2026-09-10)

**Ruling 4**, taken at the same start gate after the step-3 plan found that
decision 2 does not reach the `F1.10` disk-buffer replay path. Decision 2 says
`time` is *"the receive time, always"* and never says what the receive time of a
**buffered** sample is. `apps/ingest/src/main.ts:165` — the single call site —
passes `new Date()`.

### What decision 2 did to that path, before this amendment

`supervisor.ts:715-727`'s `replayLoop` hands 500-sample slices to the same
`resolveSamples`. So, applied literally:

1. **Replay stopped being idempotent.** A re-replayed segment takes a fresh
   `new Date()`, therefore a fresh primary key, therefore **duplicate rows**.
   ADR 0016 Amendment 4 decision 5 — *"Replay is safe because `writeResolved` is
   `ON CONFLICT DO UPDATE`: a replayed row is idempotent"* — and decision 8 —
   *"re-replays at most one minute, idempotently"* — both become false. So does
   the comment at `disk-buffer.ts:330-333`, which exists to keep them true:
   *"replay must write the same `(time, asset_id, point_key)` every time, or a
   re-replayed segment lands duplicate rows instead of an idempotent upsert."*
2. **A device timestamp would be fabricated.** `serialise` stamps the spill
   instant into a line's `at` when the sample carries none. Under decision 2
   that stamp becomes `device_time` — the invention ruling 2 refused.
3. **An hour of backlog would land within seconds**, so every recency window
   reads the whole backlog as *now*.
4. **A whole 500-slice would share one `time`**, so decision 6's collapse
   applies across the slice. §Context measured zero collisions on the **live**
   path; the replay path batches by construction, so that measurement does not
   transfer.

### The ruling

**A buffered sample's receive time is its original arrival, not the replay
instant.** The declined alternative was accepting the replay instant and
amending ADR 0016 Amendment 4 decisions 5 and 8 to say replay is no longer
idempotent — cheapest in code, and it withdraws a guarantee `F1.10` was built to
provide.

### What that costs, and one thing it does not

The segment path already encodes receipt time — decision 7's
`<epoch-minute>.jsonl`, *"one append-only segment per minute of receipt time"* —
but only to the minute, and shared by every sample in the file. Using it would
collapse a whole minute of one point into a single key. **The receive time must
therefore be per-sample and on the line**, which makes this a segment-format
change under ADR 0016 Amendment 4 decision 7, carried by that ADR's own
Amendment 5 rather than by this one.

**Segments already on disk at deploy are ambiguous and cannot be repaired.**
Their `at` holds either a device time or a spill stamp, and nothing stored
distinguishes them — the same indistinguishability decision 4 accepts for
`device_time`, one layer earlier. So the deploy sequence gains a gate:
**`buffered = 0` on every endpoint's health entry before migrating.** The buffer
is empty unless an outage is in progress, so this is a check rather than a wait
in the normal case.

**`SourceSample` does not change.** `adapter-contract.spec.ts:414-418` forbids an
adapter fabricating a time, and a receive time set by an adapter is exactly
that. The value travels from the buffer to the normaliser through a
host-internal shape.

### Consequences

- **Decision 2 is narrowed in wording, not in effect.** `time` is the receive
  time; for a live sample that is the batch's `new Date()`, and for a buffered
  one it is the arrival the buffer recorded. Both are receive times. What is
  excluded, in both cases, is the device's own clock.
- **`device_time` is NULL for a replayed sample that carried no device
  timestamp** — decision 4 case 2, reached through the buffer. This amendment
  adds no fourth case, which is the point of choosing the original arrival over
  the replay instant.
- **Replay idempotency is preserved rather than restored**, and ADR 0016
  Amendment 4 decisions 5 and 8 stay true as written.
- **The build order is fixed by this.** The plan's Tasks 1–2 (the migration and
  the six-parameter upsert) are independent and may proceed. Task 3 — the
  normaliser's semantics — may not land before ADR 0016 Amendment 5 defines the
  line format, because Task 3 is the commit that changes what a replayed row
  means.

### Verification this amendment adds

- **A re-replayed segment writes the same primary key.** Replay one segment
  twice through the host path and assert the row count is unchanged and `time`
  is identical — the assertion that owns ADR 0016 Amendment 4 decision 5. A
  mutation restoring `new Date()` as the replayed row's `time` must redden it.
- **A replayed sample that carried no device timestamp yields
  `device_time IS NULL`**, and specifically not the spill stamp. The mutation is
  to feed the stamp through.
- **The deploy gate is real**: `buffered = 0` is read and recorded before
  migrating, not asserted afterwards.
