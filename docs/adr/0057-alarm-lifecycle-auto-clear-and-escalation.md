# ADR 0057 — Alarm lifecycle: auto-clear on normal and escalation profiles

## Status

**Accepted** — 2026-09-06, by the repository owner, the same day it was
drafted, for `F3.10` (Track D, P1, Wave 1, `Depends: F3.6 ✅, F3.8 ✅`). Five
design rulings were taken by the owner in chat on 2026-09-06, all as
recommended, the four design sections below were approved one by one, and the
record was accepted as drafted ("Accept"). `plan-architect` writes the plan
next; no implementation code exists at acceptance. Effort is re-set from
`4–6` to **`8–10`** (decision 12).

**Built 2026-09-07:** PR 1 #338 (`452c1f4`, the shared sweep loop and the
event kinds), PR 2 #341 (`f9aa102e`, migration `0066` through the pages).
Amendment 1 records the plan's rulings and the facts that differ from the
text below.

## Context

`F3.6` unified the alarm engine and left one lifecycle state: an alarm is
**open** while `acknowledged_at IS NULL` and acknowledgement is its only
closure. `alarms_open_per_rule_uidx` (migration `0032`) encodes exactly that.
ADR 0033 decision 1 deferred the `/cr-overview` Active Alarms rail to `F3.10`
because "a latched alarm rail without auto-clear would accumulate every
transient simulator breach and never drain it", and its Consequences assign
`F3.10` the `bms.alarms.cleared_at` column and the auto-clear logic. ADR 0033
decision 4 accepted that the two voltage bands can both open, and named
`F3.10`'s auto-clear work as the place to revisit it.

`F3.8` (ADR 0041) built the notification service and `F3.7` (Amendment 1) made
a rule's `notify` action fire on a raise — once, to the channels joined to the
rule. Nothing today tells anyone a second time when nobody acknowledges, and
nothing tells anyone that an alarm went away. The client feature sheet
(`docs/BACKLOG.md` §8, row 8) lists *escalation* and *distribution* under
alerts; client questions B9 and B11 on the severity ladder remain unanswered
and are not needed by this record.

Two facts the design leans on, measured at `fd6117d`:

- The API already runs two sleep-loop sweeps — `runSchedulerLoop`
  (`calc-scheduler.service.ts`) and `runHealthRollupLoop`
  (`health-rollup.service.ts`) — and the latter's header says a third loop "is
  the point at which extracting the shape stops being premature".
- Today an acknowledged alarm whose condition still holds **re-raises on the
  next evaluation** as a new `bms.alarms` row. The `F3.46` stack run showed
  it: acknowledge, press *Evaluate now*, a new alarm opens. That is a
  consequence of "acknowledged means closed", not a feature anybody asked for.

Every migration this record needs must be numbered after `F2.7`'s
`0063_point_metadata` and `F3.46`'s `0064` index (both in flight on
2026-09-06), so the schema unit lands as `0065` or later.

## Decision

### Lifecycle

1. **An alarm is active while `cleared_at IS NULL`. Acknowledgement is an
   annotation, not a closure** (owner ruling Q1, the ISA-18.2 lifecycle).
   `bms.alarms` gains `cleared_at timestamptz NULL` and `normal_since
   timestamptz NULL`. The four states the SPA derives are: *active* (neither
   stamp), *acknowledged* (acknowledged, not cleared), *cleared, unacknowledged*
   (cleared, not acknowledged — it leaves the active rail and stays in the
   alarms list until an operator acknowledges it), and *closed* (both).
   `POST /api/v1/alarms/:id/ack` is unchanged and never clears.

2. **`alarms_open_per_rule_uidx` moves its predicate from `acknowledged_at IS
   NULL` to `cleared_at IS NULL`** (still `AND rule_id IS NOT NULL`). The same
   migration backfills `cleared_at = acknowledged_at` on every acknowledged row
   first, so the new predicate cannot collide with an open duplicate. After
   this, an acknowledged alarm whose condition still holds does **not**
   re-raise; a new alarm opens only after the previous one clears and the
   condition breaches again. `AlarmRaiser`'s own open test moves with the
   index (one line). The `F3.46` refusal key stops changing on every
   acknowledgement as a side effect.

3. **"Returned to normal" means fresh samples have stayed non-matching for a
   hold time** (owner ruling Q2). `bms.automation_rules` gains
   `clear_hold_seconds integer NULL`; `NULL` means the default, **120 s**. The
   condition grammar (`rule-evaluation.ts`) does not change and there is no
   deadband. A sample older than `MAX_RAISE_SAMPLE_AGE_MS` changes nothing —
   stale telemetry never clears an alarm (ADR 0027: staleness outranks every
   value-derived state).

### The sweep

4. **One `AlarmLifecycleService` sweep computes both the clear and the
   escalation steps.** It lives in `apps/api/src/alarms/`, runs in the API
   process on a **30 s** tick, and uses the loop shape extracted from the two
   existing sweeps into one shared helper (`for (;;)` sweep-then-sleep,
   injected `sleep`/`now`, `AbortController` shutdown, never `setInterval`).
   No queue, no worker, no per-alarm timers: the ledger and the two stamps are
   the only state, so a restart loses nothing and a repeated tick sends
   nothing twice. When `F4.24` lands, moving the tick onto a worker is a
   relocation, not a redesign.

5. **Clear phase, each tick.** For every active alarm with a `rule_id`, read
   the latest sample for the rule's asset and point (the existing batched
   loader), apply `isSampleFreshEnoughToRaise`, then: stale → no change;
   matching → `normal_since = NULL`; non-matching → `normal_since =
   COALESCE(normal_since, now())`, and when `now() - normal_since >=` the hold
   → `cleared_at = now()` and the cleared message (decision 9).

6. **Escalation phase, each tick.** Select alarms that are active **and**
   unacknowledged, map organization and severity to a profile (decision 7),
   and for each step whose `after_minutes` have passed since `raised_at`, send
   it once to the step's channels. Acknowledgement or clear removes the alarm
   from the selection, which is what stops the clock (owner ruling Q4). A step
   already in the ledger for that alarm is not sent again (decision 10).

### Escalation profiles

7. **A profile is an ordered list of steps, attached by severity per
   organization** (owner ruling Q3). Four tenant tables, all under the ADR
   0043 row-level-security shape and the ADR 0045 grants:
   `bms.alarm_escalation_profiles` (`organization_id NOT NULL`, `code`, `name`;
   unique per organization and code), `bms.alarm_escalation_steps`
   (`profile_id`, `step_no`, `after_minutes`; unique per profile and step),
   `bms.alarm_escalation_step_channels` (`step_id`, `channel_id` — the
   `rule_notifications` join shape), and `bms.alarm_escalation_defaults`
   (`organization_id`, `severity` → `profile_id`, primary key on the first
   two, `severity` referencing `bms.alarm_severities.code`). A per-rule
   override is a later row, not this one.

8. **No seed.** As with channels (ADR 0041 decision 11), nothing escalates
   until an operator configures a profile. Profile administration writes
   `bms.audit_log` rows like the other admin services.

### Notifications

9. **Two new event kinds ride the existing delivery path.**
   `NotificationsService` keeps `dispatch(input)` for the raise path and gains
   `dispatchToChannels(channels, input)` for an explicit channel set.
   `DispatchInput` gains an optional event — `{ kind: "escalation", step }` or
   `{ kind: "cleared" }` — which `buildDedupeKey` appends as `:escalation:<n>`
   or `:cleared` and the subject line carries. Rate limit, transports,
   `record()` and the `notification_deliveries` shape are unchanged; the kind
   lives in the dedupe key, not in a new column. **The cleared message goes to
   the channels that hold a `sent` row for that alarm** — the raise or any
   step — and to nobody else (owner ruling Q5).

10. **Idempotency is a ledger read, the `F3.46` shape.** Before a step or a
    cleared message is sent, the sweep asks the ledger whether a row with that
    dedupe key exists for the channel; `F3.46`'s partial index on
    `(channel_id, dedupe_key)` serves the read. Two overlapping ticks cannot
    happen (one loop, sweep-then-sleep), so no unique index is added.

### Surfaces

11. **Routes, contracts and pages.** `configuration` role, like the channel
    admin: `GET/POST /api/v1/admin/escalation-profiles`,
    `PATCH/DELETE /api/v1/admin/escalation-profiles/:id` (steps and step
    channels in one body), and `GET/PUT /api/v1/admin/escalation-defaults`
    (the severity map for the caller's organization). OpenAPI entries (ADR
    0029) and the strict body ledger. Contracts (ADR 0030, `packages/shared`):
    the alarm response gains `clearedAt`; the rule draft and response gain an
    optional `clearHoldSeconds`. Pages: the alarms page derives the four
    states of decision 1 and its *Active* card counts uncleared alarms; the
    rules card gets one number field for the clear hold with the default
    shown; a new `/admin/escalation-profiles` page on the
    notification-channels page pattern (list, step editor with a channel
    picker, severity map) — no mockup covers it, so that pattern is the §5
    reference. **Out of this row:** the `/cr-overview` Active Alarms rail stays
    `F3.28`; the deliveries page gets no new column.

12. **Effort `8–10`, and the plan decides the PR split.** Four tenant tables
    under RLS, a sweep, the notification split and an admin page measure like
    `F3.8` (`7–9`). The non-DDL seams — the shared loop helper, the
    `dispatchToChannels` split, the contracts — can ship first on a branch
    from `main`; every unit that touches `bms.alarms` waits for `0063` and
    `0064` on `main`.

## Dependencies

None. No npm package; no compose service. The sweep, the tables and the page
use what `apps/api`, `packages/db`, `packages/shared` and `apps/web` already
have.

## Consequences

- `F3.28`'s Active Alarms rail becomes buildable: "active" now drains, which
  is what ADR 0033 decision 1 was waiting for. `F3.28` keeps its own row.
- ADR 0033 decision 4's two voltage bands still both open on one reading; they
  now both **clear** too, once the reading holds below the lower band. The
  redundancy stays accepted; this record does not add a "below the next band"
  operator.
- The `F4.38`/ADR 0027 rule holds in the new direction: a dead sensor's alarm
  never auto-clears, so a frozen breach stays active until a human
  acknowledges it and the telemetry returns.
- A user who acknowledges an alarm no longer sees a duplicate open a minute
  later. Any operator habit built on that duplicate as a "still breaching"
  signal now reads the *acknowledged* state instead.
- The ledger grows by one row per step per channel per alarm and one cleared
  row per notified channel — bounded by real transitions, like `sent` rows.
- Two owner questions stay open for later rows, not this one: a per-rule
  profile override, and a shelve action. `E2.4` (template alarms seed rules)
  and `E2.2` (philosophy KB) are unaffected.

## Promotion follow-ups (AGENTS.md §10, owed in a separate `chore(agents):` PR)

- **`AGENTS.md` §6** — the notifications paragraph says "*It promotes no
  escalation policy either — `F3.10`'s profiles and auto-clear are a separate
  row*". When `F3.10` lands that sentence is softened to point here.
- **`AGENTS.md` §2 / status line** — an *Alarm lifecycle* row naming the two
  stamps, the sweep, the four tables and the two event kinds.
- **`docs/roadmap.md`** — flip the `F3.10` row when it lands; `docs/BACKLOG.md`
  effort cell `4–6` → `8–10` at the same time.
- **ADR 0033** — a note under decision 1 and its Consequences that the
  inherited item is discharged here. **ADR 0041** — a note that two event
  kinds now ride decision 7's key.
- None of these edits belong in the `F3.10` feature commits (§9.10).

## Amendment 1 — `F3.10` built: the rulings, the migration number, and three corrected facts (2026-09-07)

The plan (`docs/plans/f3.10-alarm-lifecycle-escalation.md`) took nine rulings
from the owner on 2026-09-06 and named three places where the text above is
not what was built. All are recorded here; none re-opens a decision.

1. **The schema unit is migration `0066_alarm_lifecycle`**, not "`0065` or
   later" as the Context guessed: `F2.7` landed `0063` and `0064`, and `F3.46`
   took `0065`. The plan's own `0065` references read `0066`.
2. **Decision 10's index is this record's own.** `F3.46`'s `0065` index is
   scoped `WHERE status = 'skipped_deduped'`, which a read for `sent` or
   `failed` rows cannot use. `0066` creates
   `notification_deliveries_channel_key_idx (channel_id, dedupe_key) WHERE
   dedupe_key IS NOT NULL`, which subsumes it, and drops `0065`'s in the same
   file (ruling Q3); `hasRecordedSkip` and the event reads share it. `0066`
   also adds `(alarm_id) WHERE alarm_id IS NOT NULL` for the cleared-message
   recipient read.
3. **Decision 2's "one line" in `AlarmRaiser` does not exist.** The raiser's
   dedupe is the database's bare `ON CONFLICT DO NOTHING`; what moved was the
   predicate in the raise integration spec and the comments that said
   acknowledgement clears the key.
4. **Decision 5's "existing batched loader" is `batchedLatestPointValues`
   over rule rows**, so the sweep selects the rule rows first and matches
   threshold rules only.
5. **The backfill is guarded on the old predicate.** `0066` runs
   `cleared_at = acknowledged_at` per organization under the tenant GUC only
   while `alarms_open_per_rule_uidx` still reads `acknowledged_at IS NULL`, so
   a replay of the file is inert and cannot close a live acknowledged alarm
   (proved by applying the file twice on a scratch database). The seed stamps
   its two acknowledged demo alarms cleared for the same reason: a fresh
   database must not hold rule-less alarms that nothing can clear.
6. **Rulings.** Q1: the dashboard KPIs, the map counts and the metric
   catalogue count active = not cleared. Q2: `clear_hold_seconds` 1–86 400,
   `after_minutes` 1–10 080 strictly increasing, at most ten steps. Q3: the
   index above. Q4: a step with no channel is refused; a profile with no
   steps is allowed. Q5: the admin page follows the channels page layout.
   Q6: profile administration sits behind the channel-admin gate. Q7: the
   once-per-key ledger read is literal — a step refused by the hourly ceiling
   is not retried in this row, and the first mapping of a severity sends the
   step to every backlogged alarm of that severity at once (52 on the seeded
   database, measured on the stack); the retry is `F3.48`. Q8: escalation
   ignores the rule's `action`. Q9 (PR 1's security review): a `failed` event
   delivery is retried, at most three attempts per key per channel
   (`MAX_EVENT_ATTEMPTS`); any other row blocks the key.
7. **Facts from the build.** At most 50 channels per step (security review).
   Foreign-organization channels are dropped at dispatch, and an event with
   no alarm id is refused. The escalation phase isolates each step in its own
   try/catch, so one channel's failure does not stop the tick. The alarms
   page's *Active* card counts uncleared alarms, acknowledged ones included,
   and was renamed from the mockups' "Active (unack)" — a divergence recorded
   under decision 11, because the mockups predate the four-state lifecycle.
   An acknowledgement on the page needs a reason (the existing dialog).
8. **The promotion follow-ups above are discharged** by the `chore(agents):`
   sweep that carries this amendment; `F3.28`'s rail is buildable.

## Amendment 2 — `F3.48`: a ceiling-refused event is retried, and decision 10's blocking set loses one status (2026-09-08)

Ruling Q7 above left a step refused by the hourly ceiling unretried and named
`F3.48` as the retry. Building it falsified the fix `docs/BACKLOG.md` proposed,
so the owner ruled twice on 2026-09-08. Decision 10 and ruling Q7 are amended
in part; ruling Q9 and the raise path are untouched.

1. **The proposed fix does not work, and that is a measurement.**
   `eventDeliveryBlocked` blocks on
   `rows.length >= MAX_EVENT_ATTEMPTS || rows.some((row) => row.status !== "failed")`
   under `.limit(MAX_EVENT_ATTEMPTS)`. Dropping `skipped_rate_limited` from the
   second arm alone leaves the first standing: the lifecycle sweep ticks every
   30 s, so three rate-limited rows land within 90 seconds and block the key
   for ever, while `isOverHourlyLimit` counts `sent` rows over a trailing hour
   and needs up to an hour to clear. The row's option (a) would burn the three
   attempts without ever reaching a tick at which the ceiling had lifted.

2. **Ruling `F3.48`-Q1 — the ceiling writes no row for an escalation step.**
   When `isOverHourlyLimit` refuses a dispatch carrying an *escalation* event,
   `dispatchToChannel` returns `skipped_rate_limited` to its caller *without*
   calling `record()`. Nothing is written, so the key is never spent and the
   next tick retries until the ceiling lifts. This is the treatment security
   review H1 already gave the branch two lines above — a failed rate-limit
   *read* writes no row on the event path — extended from the read to the
   ceiling itself, for the same stated reason: an event's key lasts the life of
   the ledger and must not be spent on a row that records no delivery decision.
   **The raise path keeps its row.** A raise key is per transition and the next
   raise is a new alarm with a new key, so ADR 0041 decision 4's "a refusal
   must be visible" continues to be served where its growth is bounded.

   **The escalation kind, not every event — ruling `F3.48`-Q-A.** The first
   draft of this amendment said "a dispatch carrying an event", and planning
   the build showed that is wrong for the other kind. `notifyCleared` is called
   only from the clear phase, for an alarm that cleared in that tick, and
   `loadActiveAlarms` filters `cleared_at IS NULL` — so a cleared message is
   dispatched once and the sweep never sees that alarm again. Under the blanket
   form a ceiling-refused clear would get no send, no row, no retry and no log
   line, which is worse than the state this row set out to fix: today it is at
   least lost visibly. So the clear keeps its `skipped_rate_limited` row.
   Decision 4's "a refusal must be visible" is traded away only where a retry
   replaces it. This costs Q2 nothing — a rate-limited row on a `:cleared` key
   blocks a read that is never issued a second time.

   Making the cleared message retryable as well was offered and declined for
   this row: it needs a new per-tick read over recently cleared alarms and a
   retention window nobody has chosen, which is a decision rather than an
   amendment.

   The cost the owner accepted: a rate-limited escalation step is no longer
   visible in the ledger as such — it appears when it lands as `sent`. A
   channel held permanently over a misconfigured ceiling therefore retries
   silently on that path, and the operator's signal for that is the raise
   path's own `skipped_rate_limited` rows on the same channel.

   **A second cost, named by the reviews rather than by the ruling.** The
   retried step does not merely wait for the ceiling — it *competes* for it.
   `isOverHourlyLimit` is one budget per `(channel, organization)` and the raise
   path shares it. Before this row a refused step wrote its row and stopped
   asking; now every due step asks on every 30 s tick until it lands, so a
   backlog becomes a standing queue rather than a single burst. At the default
   `NOTIFY_RATE_LIMIT_PER_HOUR` of 60 a 52-step backlog drains within the hour
   and this is invisible; at a low ceiling it is not, and a new alarm's raise can
   meet a full ceiling that the backlog is holding. The raise loses permanently
   when that happens, and that part is **older than this row**: a refused raise
   writes `skipped_rate_limited` under `<rule>:<alarm>:<severity>`, and the next
   evaluation arrives with `raised: false` and `alarmId: null`, so it keys on
   `<rule>:no-alarm:<severity>` and records a `skipped_deduped` row instead of
   retrying. Neither the ordering nor the staleness of a long-deferred step is
   settled here; both are filed as their own rows.

3. **Ruling `F3.48`-Q2 — a `skipped_rate_limited` row no longer blocks an event
   key.** Q1 stops new ones being written; Q2 releases the ones already there,
   including every key blocked before this row landed — the 52 backlogged
   alarms Q7 measured on the seeded stack. Without it `F3.48` would close while
   the steps it was written about stayed lost.

   **The status is excluded in SQL, not in the predicate**, and that is
   load-bearing rather than a style choice. `eventDeliveryBlocked` reads with
   `.limit(MAX_EVENT_ATTEMPTS)` and **no `ORDER BY`**, and its own comment
   gives order-independence as the reason that is sound. Filtering the sampled
   rows in TypeScript would break exactly that: a key holding three `failed`
   rows and three rate-limited ones could return an unordered sample of three
   rate-limited rows, leaving both arms false for a key that Q9 blocks. Adding
   `status <> 'skipped_rate_limited'` to the `WHERE` draws the sample from the
   blocking-eligible rows only, so both arms stay exact and the comment stays
   true.

   **No DDL, and that was measured rather than assumed.** `EXPLAIN` of the new
   read on the running stack gives `Index Scan using
   notification_deliveries_channel_key_idx`, with `Index Cond: (channel_id …
   AND dedupe_key …)` and `Filter: (status <> 'skipped_rate_limited' AND
   organization_id = …)` — the index still drives the read and the status is a
   residual filter, beside the organization predicate that was already one.
   `enable_seqscan` was off for the plan, because the local ledger holds no
   rows and an unforced choice on an empty table would show nothing; what the
   forced plan settles is that the index serves this predicate, which is the
   claim being made.

   That mixed state is **not reachable in production**, and the reason to
   prefer the SQL form is not that it occurs. Today's predicate blocks on the
   first non-`failed` row, so once one `skipped_rate_limited` row exists under
   an event key nothing further is written under it — at most one such row can
   exist, and after Q1 the escalation path writes none at all. The reason is
   that the predicate must stay exact **by construction**, because the comment
   at the head of the method is what the next reader will rely on when they
   change the limit or add a status.

   **One shape from before this row does gain an attempt, and that is intended.**
   A key holding two `failed` rows and then a ceiling refusal held three rows, so
   the old count arm blocked it at three. The new `WHERE` draws its sample from
   the two `failed` rows, so the step gets the third real transport attempt
   ruling Q9 always meant it to have. Q2 exists to release exactly this history.

   No raise key is reachable by this read. An event key carries the
   `:escalation:<n>` or `:cleared` suffix `buildDedupeKey` appends, so the two
   key spaces are disjoint and `hasRecordedSkip` is not touched.

4. **Ruling Q7 is superseded in part.** "A step refused by the hourly ceiling is
   not retried in this row" was true of `F3.10` and is false from `F3.48`
   onward. The rest of Q7 — that first mapping a severity sends the step to
   every backlogged alarm of that severity at once — still holds and is still
   the burst this row exists to survive. Ruling Q9 is unchanged: a `failed`
   event delivery is retried at most `MAX_EVENT_ATTEMPTS` times per key per
   channel, and every status other than `skipped_rate_limited` still blocks.

5. **What this row deliberately does not fix.** `skipped_unconfigured` blocks an
   event key by the same mechanism, so a step refused while its channel had no
   transport configured is still never retried after an operator configures
   one. That is the same defect on a different status, with a different
   trigger and a different visibility argument, and it is filed as its own
   `docs/BACKLOG.md` row rather than widened into this one.

## Amendment 3 — `F3.50`: an unconfigured refusal stops answering once the configuration moves (2026-09-08)

Amends **decision 10** and **Amendment 2 §5**. Ruling Q9, Amendment 2's rulings
Q1/Q2/Q-A and the whole raise path are unchanged. ADR 0041 needs no amendment of
its own: decision 4 asks that a refusal be visible, and this row keeps writing
the row it is about — what changes is the read.

1. **What Amendment 2 §5 held out, and why it needed a different fix.** A
   ceiling refusal is a self-clearing postponement, so `F3.48` could simply stop
   writing it. An unconfigured channel is a **configuration fault an operator
   must see and fix**, so the row is the signal and deleting it would hide the
   problem. `F3.50` therefore does not touch the write at all. It changes when
   the row stops being an **answer**.

2. **Ruling Q1 — the watermark is `max(channel.updatedAt, PROCESS_STARTED_AT)`.**
   A `skipped_unconfigured` row answers an event key only while it is newer than
   that instant.

   Five sites produce the status, and they do not split cleanly into
   "configuration" and "environment" — the last one spans both:

   | Site | Cause | Cleared by | Watermark half |
   |---|---|---|---|
   | `webhook.transport.ts` | no `config.url` | PATCH `config` | `channel.updatedAt` |
   | `email.transport.ts` | no recipients in `config` | PATCH `config` | `channel.updatedAt` |
   | `log.transport.ts` via `transportFor`'s fallback | the `kind` has no transport | PATCH `kind`, or a code change | `channel.updatedAt`, or a restart |
   | `log.transport.ts` via `transportFor`'s `smtp === null` branch, and `email.transport.ts`'s defensive twin | `SMTP_HOST` unset | set the variable, restart | `PROCESS_STARTED_AT` |
   | `webhook.transport.ts`, `secretState: "unreadable"` | the key is unset, **or** it is the wrong or a rotated key, **or** the row is corrupt | a restart **or** re-saving the secret | both halves |

   **Why the process boundary is principled and not a hack.** Two of those
   causes have no row to stamp, and **readiness cannot flip inside a process** —
   so process start is not a proxy for a readiness change; it is the only
   boundary at which one is observable. `ChannelsService.readiness()` is the
   method that computes it, *not* `NotificationsService.readiness`, which
   `docs/BACKLOG.md`'s `F3.50` row misnamed.

   That stability has two different sources, and an earlier draft of this
   amendment collapsed them. `notificationsConfig` genuinely is frozen — it is
   `buildConfig(process.env)` evaluated at module load, and `EmailTransport`
   goes further and decides its sender in its constructor. But
   `CredentialCryptoService.isConfigured()` reads `process.env` on **every**
   call; it is not a snapshot. What holds it still is that a running process's
   environment does not change. The ruling is unaffected — the conclusion is the
   same either way — but the justification had to stop claiming a cache that
   does not exist.

   The accepted cost is bounded and one-directional: one retry, and one row, per
   stranded key per watermark move.

3. **The exclusion is in the SQL `WHERE`, scoped to one status against a
   timestamp.** Amendment 2 §3's argument transfers verbatim — the read takes
   `MAX_EVENT_ATTEMPTS` rows with no `ORDER BY`, and order-independence is what
   makes both arms exact — and here it is **stronger than it was for `F3.48`**.
   Amendment 2 §3 had to concede that its mixed state was unreachable in
   production. This one is reachable: one stale row accumulates per restart, so
   a key can legitimately hold one `sent` row and three stale
   `skipped_unconfigured` ones. A TypeScript filter over an unordered sample of
   three could then return the three unconfigured rows, empty itself, leave both
   arms false — and **send an event that was already sent**.

   Written as `or(ne(status, 'skipped_unconfigured'), gt(attempted_at, …))`, not
   as the literal `NOT (status = … AND attempted_at <= …)`. They are the same
   predicate, both columns being `NOT NULL`, but the literal form renders
   `"status" = $n` and reddens Amendment 2's own SQL-shape gate
   (`notifications.events.spec.ts` case 14), which exists to stop an equality on
   `status` blocking every key that is *not* the named status. The twin costs
   nothing and leaves case 14 standing as a free gate on this clause too.

   **It must not be hoisted into the top-level `and`.** A watermark over the
   whole read would drop a `failed` row older than it out of the sample, and
   ruling Q9's three-attempt cap would silently reset every time an operator
   edited a channel. `storm-control.integration.spec.ts` plants three back-dated
   `failed` rows for exactly that mutation; rows planted at `now()` would have
   survived it.

4. **No DDL, measured rather than assumed.** With `SET enable_seqscan = off` —
   stated for Amendment 2's own reason, that the local ledger is nearly empty and
   an unforced choice would show nothing — the read plans as:

   ```
   Limit
     ->  Index Scan using notification_deliveries_channel_key_idx on notification_deliveries
           Index Cond: ((channel_id = …) AND ((dedupe_key)::text = …))
           Filter: (((status)::text <> 'skipped_rate_limited') AND (organization_id = …)
                    AND (((status)::text <> 'skipped_unconfigured') OR (attempted_at > …)))
   ```

   The equality on `dedupe_key` proves migration `0066`'s partial predicate, so
   the index still drives the read and the new clause is a residual filter beside
   the organization predicate that was already one.

5. **The growth bound, and it is reached by the other arm.** The planning note
   for this row said three fresh rows would hit `MAX_EVENT_ATTEMPTS`. They never
   do. `skipped_unconfigured` is not `failed`, so
   `rows.some(row => row.status !== "failed")` blocks on the very first fresh
   row: a released key is re-offered on the next tick, that tick writes **one**
   row, and the key is blocked again. Three *fresh* unconfigured rows under one
   key is not a reachable state — no test asserts on one.

   Two corrections to how that bound was first written, both found in review.

   **It is one row per key per WATERMARK MOVE, not per restart.** §6(a) already
   says any PATCH moves the watermark, so two renames inside one process give
   two fresh rows per stranded key in that process. As first written §5
   contradicted §6(a).

   **And "blocked again" has one carve-out, where this row's retry meets
   `F3.48`'s.** The hourly ceiling is checked *after* the event-dedupe read, and
   since Amendment 2 ruling Q1 a ceiling-refused escalation step writes no row
   at all. So a released key that meets a closed ceiling is not blocked again:
   it is re-offered every tick until the trailing hour drains. The growth bound
   is unharmed — nothing is written — and nothing extra is sent. The cost is two
   ledger reads per tick per such key, which is `F3.53`'s subject, and it is
   reachable at exactly the shape ruling Q7 measured: an operator fixes a
   channel, ~52 stranded keys release into one tick, and those above
   `ratePerHour` spin until the hour drains.

6. **Accepted costs and residuals.**

   (a) **Ruling Q2 — any PATCH releases the channel's stranded keys, a rename
   included.** `ChannelsService.update` stamps `updated_at` unconditionally,
   before it examines a single field, so renaming a channel or toggling
   `enabled` off and on moves the watermark. At ruling Q7's measured shape — 52
   backlogged alarms — a rename produces up to 52 retries and 52 fresh rows
   inside one 30-second tick, competing for the single hourly budget `F3.52` was
   filed about. Accepted rather than narrowed: without column-level change
   tracking `update()` cannot tell a configuration write from a rename, and the
   error direction is toward delivery.

   That 52-key figure is for **one** organization. A fleet-managed global
   channel (`organization_id IS NULL`, decision 7 of ADR 0041) is a legitimate
   escalation target for every tenant and carries **one** `updated_at`, while
   `isOverHourlyLimit` has been scoped per `(channel, organization)` since
   `E7.1c`. So one PATCH to a global channel releases every tenant's stranded
   keys at the same instant, and aggregate egress to that single endpoint is
   `N_organizations × ratePerHour` rather than `ratePerHour`. The trigger is
   correctly gated — `AccessControlService.canManageNotificationChannel` returns
   `false` for an `organization_admin` when the channel's organization is
   `null`, so only a global `admin` can move that watermark — and the
   per-tenant ceiling split predates this row. Recorded here because §6(a)'s
   single-tenant figure would otherwise understate it; the contention itself is
   `F3.52`'s.

   (b) **The watermark is an API-clock value compared against DB-clock rows.**
   `updated_at` is `new Date()` in the API process for every channel that has
   ever been PATCHed, `PROCESS_STARTED_AT` is Node's, and `attempted_at` is
   always Postgres's `defaultNow()`. Both skew directions are bounded and neither
   is reachable at realistic skew: an API clock far enough behind leaves a key
   blocked, and one far enough ahead excludes fresh rows too and weakens §5's
   bound. The integration suite binds a JavaScript `Date` rather than writing
   `now()`, and says in its comment that a suite on one machine cannot reproduce
   the skew and should not pretend to.

   (c) **There is no `ON UPDATE` trigger on `notification_channels.updated_at`,**
   so a DBA editing `config` directly in psql does not release the key until the
   next restart. The API is the only supported write path; a trigger would be DDL
   for a path this product does not use.

   (d) A key holding stale unconfigured rows and fewer than `MAX_EVENT_ATTEMPTS`
   `failed` ones gains a real transport attempt. That is the intended effect, and
   it is the same one Amendment 2 §3 recorded for `skipped_rate_limited`.

7. **Inert for `kind: "cleared"`, and said rather than special-cased.** The read
   is shared by both event kinds, but `notifyCleared` runs once from the clear
   phase and `loadActiveAlarms` filters `cleared_at IS NULL`, so no cleared key
   is ever read a second time and no release can be observed on that path. This
   is the read half of the asymmetry ruling Q-A created on the write half: Q-A
   special-cased the *write* because a clear had something to lose — its only
   visible row — while the read has nothing to gain from a special case, so it
   gets none.

8. **Not fixed here:** `F3.51`, `F3.52`, `F3.53` and `F3.54`, all filed by
   `F3.48`, and the ledger's retention (`F3.46` ruling 0).

## Amendment 4 — `F3.54`: two failed reads keep a cleared message's refusal row (2026-09-08)

Amends **decision 10** and **Amendment 2's ruling Q-A**. Unchanged: ruling Q9,
Amendment 2's rulings Q1 and Q2, Amendment 3's ruling Q1, the whole escalation
path and the whole raise path. **ADR 0041 needs its own amendment**, and not
because decision 4 is eroded — it is served, since two more refusals become
visible — but because Amendment 3 of that ADR names plan D3 and security review
H1 as unconditional exceptions, and after this they are conditional.

1. **What ruling Q-A established, and why it stopped one branch short.** Q-A's
   argument is about the *cleared kind*, not about the ceiling: a clear is
   dispatched once from the clear phase, `loadActiveAlarms` filters
   `cleared_at IS NULL`, so there is no later tick to retry it and a missing row
   buys nothing while costing the only evidence. `F3.48` wrote that argument
   into the exit it happened to be changing and left two adjacent exits
   discriminating on `input.event !== undefined`. Both predate `F3.48`, which
   only made the inconsistency visible by naming the principle. Both emit a
   `warn`, so this was never the fully silent shape.

2. **Ruling 1 — both ternaries narrow to the kind.** Each becomes
   `input.event?.kind === "escalation"`, so a refused *cleared* message writes
   its `failed` row while an escalation step still writes nothing:

   | Exit | escalation | cleared | raise |
   |---|---|---|---|
   | D3 — failed ledger read | no row, retried next tick | **row** | not reachable |
   | H1 — failed ceiling read | no row, retried next tick | **row** | row (unchanged) |
   | The ceiling refusal (Q-A) | no row, retried next tick | row | row (unchanged) |

   All three exits now ask **the same question through the same call**,
   `offeredAgainWithoutAsking(input.event)`. That is the row's closing complaint
   answered: they state one rule instead of two, and the reason is one reason —
   the key must survive for the next tick to retry the step.

   **The predicate names the property, not the kind, and it is exhaustive**
   (security review of this row). The first cut of this change tested
   `event?.kind === "escalation"` inline at each exit, which is correct for the
   two kinds `DispatchEvent` has and silently wrong for a third: a new *retried*
   kind would fall to the `record()` branch and poison its own key for every
   later tick, with the compiler reporting nothing. The predicate switches
   exhaustively over the union, so a third kind is a missing return — a compile
   error — rather than a behaviour change. What the exits turn on is whether the
   sweep will offer that dispatch again on its own, which is why the function is
   named for that and not for `escalation`.

3. **Ruling 2 — two further no-row exits stay out of scope, and are named here
   so they are not re-filed as a gap.** `dispatchToChannels` refuses an event
   with no alarm id outright (review L2, returns `[]`) and drops a channel whose
   organization is not the input's (review M2). Both write nothing and both
   would apply to a cleared message. They refuse the **pairing**, before
   `buildDedupeKey` has run, so there is no key for a row to be attributed
   under — a different class from refusing a send — and neither is reachable
   from `notifyCleared`, which always passes a real alarm id and sends only to
   channels already holding a `sent` row for it.

   A third exit belongs in this paragraph and is **correct as it stands**: when
   the ledger read answers that the key is already taken, `dispatchToChannel`
   returns `skipped_deduped` and writes nothing, for a clear as for a step. The
   row that answered the key **is** the evidence, and a second row would restate
   it — which is exactly what `F3.46` closed.

4. **Accepted costs.**

   (a) On a genuinely dead ledger the D3 path now emits its `warn` *and*
   `record()`'s `logger.error` for the same event, because the insert runs on
   the connection that just failed the read. The honest claim of this change is
   therefore that the cleared path **attempts** the row. That is argued rather
   than gated: an Effort-1 row does not buy a log-capture harness for a
   consequence nothing branches on.

   (b) On a total outage the clear phase now attempts one INSERT per (cleared
   alarm × channel) before giving up, where it previously returned at once.
   Bounded, on the failure path, inside a serial loop.

   (c) Growth is one row per (alarm, channel), and **in production it is exactly
   one, because `notifyCleared` runs once** — `runClearPhase` calls it only for
   the ids `writeAlarmState` actually committed, and `loadActiveAlarms` never
   returns that alarm again.

   That single dispatch is the bound at D3, and it has to be: §3's
   already-answered exit needs `eventDeliveryBlocked` to **succeed**, and at D3
   the failing read *is* that read, so a hypothetical re-offer would add a row
   per tick with nothing stopping it. At H1 the picture is different — the
   failing read is the ceiling's `{count}`, so the ledger read still runs and
   three `failed` rows would trip `MAX_EVENT_ATTEMPTS`. An earlier draft of this
   section gave §3's exit as the bound for both, which generalised one exit too
   far.

   (d) **Ruling 3 — the row is written `failed`, a retriable-shaped status for a
   refusal that will never be retried.** Accepted. Nothing reads that key again:
   the dedupe key carries the alarm id, an alarm clears once
   (`writeAlarmState` matches `cleared_at IS NULL`), and a re-raise is a new
   alarm with a new key. So the mismatch is cosmetic, where a sixth terminal
   status would be a migration, a contract change and every reader.

   (e) The delivery DTO carries no `dedupeKey` and no event kind, so the
   deliveries view cannot say a `failed` row was the *cleared* message.
   `"delivery ledger read failed"` happens to be a unique discriminator now —
   D3 is event-only, and escalation stops writing it — but
   `"rate-limit check failed"` stays ambiguous between a raise and a clear. A
   follow-up row carries it rather than widening this one.

5. **Which layer holds which claim.** The unit spec holds that the insert is
   **attempted**, both branches and both kinds — and it can, because its fake's
   `failDeliveryReads` and `failInserts` are independent flags. The integration
   spec holds that the row **lands in Postgres and reads back**, against the
   real status CHECK and the real foreign keys. There the read failure is
   synthesised by blinding one `select` projection, because inducing a real one
   means revoking a grant or terminating a backend on a shared database; the
   four projections in this service are disjoint, so blinding one fails exactly
   one read while the INSERT goes to the real database. Each block asserts both
   kinds, and the escalation half is what kills the over-broad mutation "record
   on every event" — which the cleared half alone would pass.

## Amendment 5 — `F3.51`: the sweep gains a third phase, `runRaiseRetryPhase`, between the clear and the escalation (2026-09-09)

A raise notification that did not send was lost for the life of the alarm.
Its outcome is recorded under the key `rule:alarm:severity`; the next
evaluation of the same rule arrives with `raised: false` and `alarmId: null`,
so `buildDedupeKey` produces the different key `rule:no-alarm:severity`, the
dispatch lands in the transition-dedupe branch (`F3.46`), writes
`skipped_deduped`, and sends nothing. The alarm stays open, nobody is told, and
the ledger row — `failed`, `skipped_unconfigured` or `skipped_rate_limited` —
reads as a delay rather than as the loss it is. `runLifecycleSweep` gains a
third phase, `runRaiseRetryPhase`, that re-offers a still-active alarm's
**original** raise — the same `DispatchInput`, the same message, the same
dedupe key, `event: undefined`, `reoffered: true` — to exactly the channels the
ledger shows are still owed it. ADR 0041 Amendment 5 amends decision 4 for the
one exit this touches there; this amendment is the reasoning.

**The four owner rulings, in the order given, and what each bought.**

1. **A retry path, not a terminal status.** The fix lives entirely inside the
   existing 30 s sweep. No DDL, no new `notification_deliveries` status: a
   sixth status would be a migration, a contract change and every reader of the
   column, for a defect the sweep can fix by asking again.

2. **The stop condition reuses `MAX_EVENT_ATTEMPTS`** — and the ruling's own
   qualification is what makes it work — **the whole predicate**
   `eventDeliveryBlocked` already applies, not a hand-rolled count. Hand-rolling
   "no `sent` row and fewer than three rows" would make the unconfigured case a
   60-second no-op: the original raise writes row 1, two 30 s retry ticks write
   rows 2 and 3, the cap is spent inside a minute, and an operator configuring
   SMTP an hour later changes nothing. That is `F3.48`'s falsified premise,
   reproduced on the raise path, and `channelsOwedTheRaise` avoids it by
   applying the two status exclusions before the two blocking arms, in the same
   order, with the same operators: a `skipped_rate_limited` row never counts
   toward the cap and never blocks by itself (`F3.48` ruling Q2); a
   `skipped_unconfigured` row blocks only while it is newer than
   `unconfiguredWatermark(channel, PROCESS_STARTED_AT)` (`F3.50` ruling Q1, now
   one function called from both the event path and this read); `maxAttempts`
   eligible rows, or any eligible row that is not `failed`, blocks as before.

3. **A channel with zero rows under the raise key is not owed.** This is the
   same-tick double-send guard, evaluated over every row for the channel before
   the two exclusions are applied — a channel whose only rows are all
   rate-limited or all stale-unconfigured has evidence and an empty eligible
   set, and computing the evidence test after the exclusions would silently
   kill both of those cases. It replaces any clock or grace constant: there is
   no window to tune and nothing to expire, only the question of whether the
   raise has been offered to this channel at all.

4. **An acknowledged alarm is skipped.** The reason is the message itself. The
   retry is the raise text verbatim, and that text asserts a novelty — a new
   alarm, first told — the alarm no longer has once somebody has acknowledged
   it. Re-sending the original wording to an already-acknowledged alarm would
   be a lie about its own freshness, not merely a redundant notification.

   **A correction to this amendment as first written** (`F3.51` review). It
   justified the ruling by contrast: the escalation phase "keeps sending steps
   to an acknowledged alarm because a step is the organization's severity
   policy escalating regardless of who is looking". That is false.
   `runEscalationPhase` skips on `acknowledgedAt !== null` at its first test,
   and decision 6 above says in so many words that acknowledgement removes the
   alarm from the selection. The two phases agree, there is no contrast to
   draw, and the reason above stands without one.

**Position, and it is load-bearing in both directions.** The phase runs after
the clear phase and before the escalation phase. After the clear: an alarm
that cleared this tick has already had its `cleared` message dispatched, and
re-offering its raise afterwards would tell people about a resolved alarm in
the wrong order — the phase skips every id in `clearedIds`. Before the
escalation: the two phases share one hourly budget per `(channel,
organization)` (`isOverHourlyLimit`), and whichever dispatches first takes it;
putting the raise first means an escalation backlog cannot starve a new
critical alarm's raise, which is exactly the starvation `F3.52` was filed
against. The ordering is the only prioritisation this row ships — it does not
split the budget, it only decides who asks for it first.

**What ruling 3 narrows, stated honestly.** The evidence conjunct means a raise
that never reached the ledger at all is never retried by this phase — a
rejected ledger read at the raise's own dispatch time writes nothing, and
`record()`'s own insert can fail independently of the read. Both leave zero
rows under the key, and zero rows reads as "not yet offered", not as "owed".
This is a real limit and not a rounding error: all three of the cases named
against this backlog row — a `failed` transport, a `skipped_unconfigured`
channel, a `skipped_rate_limited` refusal — do write a row, so nothing this
row was asked to fix is dropped by the narrowing. A raise whose own row never
landed is a different, older defect than the one this row closes.

**The accepted cost.** A channel held over a misconfigured hourly ceiling for
the life of an alarm is re-offered its raise on every tick, forever: two reads
a tick — the ledger query and the channel query — nothing written, nothing
sent, no ledger growth. This is the same cost Amendment 2 §2 above already
accepted on the escalation path, reaching the raise path for the first time.
`F3.53` owns the per-tick read cost; `F3.52` owns splitting the hourly budget
between the raise and event paths, so the two phases stop contending for one
number.

**The inherited, unfixed complaint.** The retried message carries no age and
no staleness marker — deliberately, not by oversight. Byte-identity with the
original raise's `DispatchInput` is what lets `channelsOwedTheRaise` match the
ledger rows the original dispatch wrote; a `:retry` suffix on the key or a
prefix on the subject would orphan every row the phase is trying to read. This
is `F3.52`'s second half, named here so it is not mistaken for an oversight of
this row, and this row does not fix it.

**Build corrections against the plan this row was gated on.** The ledger read
that the phase needs — every delivery row under a set of alarms' raise keys,
in one query — is a **module function**, `loadRaiseAttempts` in
`apps/api/src/notifications/raise-attempts.ts`, not a `NotificationsService`
method: that class stood within a few dozen lines of AGENTS.md §4.5's
1000-line cap after ADR 0041 Amendment 5's changes, and the read needs nothing
from the class but `fleetDb`. `AlarmLifecycleService` already held `fleetDb`
and already called a sibling module (`loadEnabledChannelsByIds`) the same way,
so the constructor is unchanged. `EXPLAIN (ANALYZE, BUFFERS)` against
`notification_deliveries_alarm_idx ON (alarm_id) WHERE alarm_id IS NOT NULL`
(migration `0066`), measured on 20 000 rows over 2 000 alarms, 2026-09-08:
`Index Scan` at every list size tried — 1, 3, 50 and 300 refs — with no
sequential scan at any of them, organization and dedupe key reaching the
planner as residual filters; 300 refs cost 3.27 ms and 969 shared buffer hits.
On a rejected ledger read the phase warns and returns, and never falls back to
treating channels as owed — a blind re-offer would duplicate every open
alarm's raise to every one of its channels — and `runEscalationPhase` still
runs in the same tick, because the `return` is scoped to the raise-retry
phase's own function. The warn is phase-wide, carrying the count of eligible
alarms and the failure's cause, and no id list: the read covers every eligible
alarm in one query, so a list of their ids is unbounded at even a few hundred
open alarms.

### Amendment 5 §2 — three corrections the `F3.51` review forced (2026-09-09)

The review of the branch above found three defects. All three are fixed on the
same branch, and each falsifies something this amendment or the code said, so
each is recorded here rather than left for the next reader to discover.

**1. A ledger row that did not land had no bound at all (High).**
`NotificationsService.record()` catches its own INSERT failure, logs an error
and returns the result — ADR 0041 decision 1, which is unchanged. But every
bound this amendment leans on counts ROWS: `MAX_EVENT_ATTEMPTS` counts them
under the key, and `isOverHourlyLimit` counts `sent` ones over a trailing hour.
A ledger that refuses writes while serving reads therefore leaves the raise
retry with nothing that can stop it: no row appears, `channelsOwedTheRaise`
keeps seeing the same single original `failed` row, and the phase sends to that
channel twice a minute for the life of the alarm with no trace of any of it.

`record()` now reports whether its row landed. Every dispatch result carries
`rowLost` and its `channelId` (`DispatchOutcome`), and the phase keeps an
in-process `LostLedgerRows` of the `(alarm, channel, dedupe key)` triples whose
insert threw, and does not re-offer them. The triple, not the pair: a raise key
is `rule:alarm:severity` and the builder reads the ALARM's severity, so an
alarm re-severitied under the sweep has a genuinely different key with
genuinely no rows, and the pair alone would suppress a raise never offered.
The memory is capped at 1000 entries and REFUSES rather than evicts — dropping
an existing entry would silently un-blacklist a real loss.

**Three narrowings this paragraph needs, all found by the second review (§3).**
It says "the phase", and there are two — the escalation phase had the same
loop and now feeds the same memory under each step's own key. It says the
memory is "reclaimed when an alarm leaves the active set", and the reclaim is
best-effort: `retainAlarms` is called from `runRaiseRetryPhase` alone, and
`runLifecycleSweep` returns before every phase when no alarm is active, so a
quiet fleet reclaims nothing until its next alarm. And the memory is **one
strike** — a single transient insert failure suppresses that triple until the
alarm clears or the process restarts, even where the send failed too, while the
ledger bound it stands in for allows three attempts. That is a consequence of
"refuse rather than forget", not a defect: telling a transient failure from a
permanent one would mean asking the ledger, which is the thing that is not
answering.

**The sweep's "no phase remembers anything between ticks" is now false, and the
honest statement is narrower.** The ledger remains the only **cross-process**
state. `LostLedgerRows` is in process and a restart empties it. That is forced
rather than chosen — a bound that survived a restart would have to be a row,
and a row is exactly what could not be written — and it is the treatment
`PROCESS_STARTED_AT` already gives the unconfigured watermark (Amendment 3).

**A restart costs one extra send per remembered pair**, which the first wording
("the retry resumes as if the losses had not happened") read as costing
nothing. The ledger still holds the same `failed` row and it still reads as
"owed", so the first tick after a restart offers every remembered pair again.
Under a restart LOOP that is unbounded, and a database refusing writes is
exactly when this API may be crash-looping — the two failures arrive together.
**Decision 4 above still says "a restart loses nothing".** That was true of the
sweep as designed, when the ledger and the two stamps were the only state; it
is not true of the sweep as built, and this paragraph is the correction rather
than an edit to the decision.

**2. One tenant's alarm volume disabled the phase fleet-wide (Medium).**
`loadRaiseAttempts` bound one `alarm_id` and one `dedupe_key` per eligible
alarm in ONE statement — roughly two of Postgres' 65535 bind parameters per
alarm, so the statement failed outright at roughly 32 700 eligible alarms.
`loadActiveAlarms` spans every tenant and the phase's `catch` returned from the
whole phase, so no tenant's raise was retried until the count dropped.

The read is chunked at 500 refs (at most 1500 parameters, 2.3 % of the budget)
and the failure handling moved from the phase to the statement. It returns the
rows every batch that returned holds, the alarm ids of every batch that did
not, and one reason per failed batch; the phase warns once with those counts
and decides the alarms it has evidence for. **Two claims above are now narrower
than they read:** the phase's reads per tick are `ceil(alarms / 500)` ledger
statements rather than one, and the `EXPLAIN` figures recorded above were
measured on the single statement and are therefore per BATCH — the 300-ref line
is the shape a full batch approaches. The warn is still phase-wide and still
carries no id list, for the reason given above, and `runEscalationPhase` still
runs in the same tick.

**3. A hung SMTP server held every phase for every tenant (Medium).**
`createSender` passed no timeout, so nodemailer used its defaults: two minutes
to connect and ten minutes of socket inactivity. The sweep awaits
`dispatchToChannels` and `runSweepLoop` is sweep-then-sleep, so one silent SMTP
server held that tick, its escalation phase, and every phase of every later
tick, for every tenant. `connectionTimeout` and `greetingTimeout` are 5 s and
`socketTimeout` 10 s. **The exposure is not new to this row** — `notifyCleared`
and the escalation phase have awaited that transport inside this sweep since
`F3.10` — and **the bound is per SEND, not per tick**: `dispatchToChannels`
loops its channels sequentially, so N email channels still serialise.

**"All well under the 30 s tick" was false, and §3 below replaces it.** None of
those three constants bounds a send. Measured against nodemailer 6.10.1 as
installed: `dnsTimeout` was unset and defaults to 30 s — as long as the whole
tick — and `smtp-connection/index.js:228` hands it to the resolver, which runs
*before* `setupConnectionHandlers` arms the 5 s `connectionTimeout`, on every
branch of `connect` that opens a socket (`:265/291`, `:309/335`, `:342/368`);
the one branch that arms the timer first (`:243`) takes a caller-supplied open
connection and resolves nothing, and this transport supplies none.
`socketTimeout` reaches the socket through `_socket.setTimeout` (`:723`,
`:952`), which is an inactivity timer that every byte resets, so a server
emitting one byte every 9 s never trips it; and `readRecipients` caps nothing,
so each `RCPT TO` of a long `config.to` gets its own fresh window. `dnsTimeout`
is now set and the awaited `sendMail` is raced against an absolute
`SEND_DEADLINE_MS`, which is the only one of the five that bounds the sweep —
at 20 s it is deliberately smaller than the other four can sum to, so in the
worst case it fires before they are ever reached.

**And four documentation claims, each false rather than merely loose.** Ruling
4's contrast with the escalation phase is struck above and the reason it
misstated is recorded there. `alarm-lifecycle.service.spec.ts` said its
thirteen cases were "unchanged"; one was not, and both that file and its
sibling now say which. `raise-retry.ts` justified its two parameters by runtime
weight — "importing either would drag drizzle and Nest" — which is false:
`notifications.config.ts` has zero imports and `dispatch-policy.ts` imports
only types; the real reason is that a suite cannot move a constant.
`notifications.service.ts` said "neither case reaches step 1", which
contradicted the clause after it — an ordinary raise with `raised: false` does
reach step 1, and that is where `F3.46`'s transition dedupe lives.

### Amendment 5 §3 - four more corrections the second review forced (2026-09-09)

The branch was reviewed again after §2 landed. One error was breaking CI, three
were defects, and seven documentation claims were false. What follows is what
changed in this ADR's territory; ADR 0041 Amendment 5 §3 carries the dispatch
side of the same findings.

**0. `pnpm typecheck:tests` was red, and no other gate could see it.**
`dispatch()`'s return widened to `DispatchOutcome[]` in §2 and
`rules/rule-actions.spec.ts` still declared `DeliveryResult[]` (TS2322).
`tsconfig.build.json` excludes `**/*spec.ts` and vitest strips types with
esbuild, so `pnpm build` and `pnpm test` were both green on a branch that could
not compile its own tests. Recorded here because the lesson is about the gate,
not the type: widening a return that a spec fakes is invisible to two of the
three suites this repository runs.

**1. The escalation phase had §2's defect and did not get §2's fix (High).**
`runEscalationPhase` discarded `dispatchToChannels`'s outcomes. With the ledger
serving reads and refusing inserts, `eventDeliveryBlocked` found no row under
the step's key, never blocked, `isOverHourlyLimit` counted no `sent` rows, and
the due step was re-sent on every 30 s tick for the life of the alarm with no
ledger trace at all - decision 10's idempotency is a read, and a read can only
answer from rows that exist.

Both phases now share one helper and one `LostLedgerRows`, keyed on the dispatch
each is re-offering: the raise key for the retry, `...:escalation:<n>` for a
step. Never one key for both - a lost step row must not silence the raise, nor a
lost raise row a step - and the separation is gated by
`alarm-lifecycle-escalation-lost-rows.spec.ts` E1, which fills the memory with
the raise key and asserts the step still goes. The instance and therefore the
cap are shared; escalation losses can spend the raise path's slots, which is
recorded rather than left to be found.

**2. A control character in a transport error cost a lost row on demand
(Medium).** The cap at 1000 entries is deliberately fillable, and past it the
degradation is the unbounded per-tick re-offer this whole amendment exists to
stop - dispatched sequentially, so under a slow transport one tick can outlast
the 30 s period and stall the sweep for every tenant. The trigger was
attacker-controllable: `readBounded`'s `.replace(/\s+/g, " ").trim()` does not
remove `U+0000`, `notification_deliveries.error` is `text`, and Postgres refuses
the parameter - measured against the real database as `invalid byte sequence for
encoding "UTF8": 0x00`, with `rowLost` coming back `true`. Control characters
are now stripped where the error is recorded (ADR 0041 Amendment 5 §3 item 2).

**3. §2 item 3's SMTP bound was not a bound (Medium).** It claimed
`connectionTimeout`, `greetingTimeout` and `socketTimeout` were "all well under
the 30 s tick". Two of them bound only the opening of the connection, the third
is an inactivity timer that a dribbling server resets for ever, and `dnsTimeout`
- unset, defaulting to 30 s, and consulted before the connection timer is armed
- was not among them at all. The corrected measurement is recorded against that
paragraph above. `dnsTimeout` is now set and one absolute `SEND_DEADLINE_MS`
races the awaited `sendMail`.

**What the deadline does not fix, stated so it is not read as more than it is.**
The abandoned send is not cancelled - nodemailer has no per-message abort - so a
hostile server keeps that socket until one of its own timers fires. The sweep
gets its tick back, which is the property the tick needs; the socket is not
bounded, and closing the transport under the send would take a pooled connection
out from under any concurrent one.

**And the documentation claims.** `LostLedgerRows.has` had no JSDoc while every
other member did (§4.1). `alarm-lifecycle-raise-retry.spec.ts` R19 named the
wrong mechanism for its own mutation - an evicting cap does not redden it by
re-offering C2, which is not in that fixture's channels, but by leaving nothing
refused and nothing warned. The remaining five are corrections to sentences
above, each made in place: the memory's one-strike behaviour, the best-effort
reclaim, the two phases rather than one, the restart's true cost, and the SMTP
bound.

## Amendment 6 — `F3.55`: a cleared message that reaches nobody says so, at both of the two returns that were silent (2026-09-09)

Amends **decision 9** in one respect and leaves **owner ruling Q5's recipient
set exactly where it stands**: the cleared message still goes to the channels
that hold a `sent` row for that alarm and to nobody else. What changes is what
happens when that set turns out to be empty. Unchanged: decision 10,
Amendment 2's rulings Q1, Q2 and Q-A, Amendment 3's ruling Q1, Amendment 4's
three rulings, the whole of Amendment 5, and every status the ledger can hold —
this amendment adds no row, no column, no migration and no contract change.

**The two returns, and they are not one case.** `notifyCleared` reads twice and
returned early after each. Neither return sent anything, recorded anything or
wrote a log line:

- `sentChannelIdsForAlarm` answers with an empty list — **no channel holds a
  `sent` row for this alarm**, either because no channel is joined to the rule
  at all or because the raise left no `sent` row behind (two readings, below).
- `loadEnabledChannelsByIds` answers with an empty list over a non-empty set of
  ids — the channels did hold one, and **every one of them is disabled now**.

The second is the shape this row was filed against: a channel took the raise,
an operator disabled it, and the clear arrives with nobody to tell. The first is
the commoner one today — on a database where nobody has joined a channel to the
rule, it is what every clear of that rule logs. Both were the fully silent
shape — no send, no row, no retry,
no log — which is precisely what Amendment 2's ruling Q-A calls worse than the
defect `F3.48` set out to fix. They survived `F3.54` because they sit one layer
**above** `dispatchToChannel`: Amendment 4's two ternaries live inside that
method, and control never reaches it when the channel list is empty.

**The ruling — a `warn` at both, and no delivery row at either.** The reason
differs at each, and that is why they are two rulings and not one.

At the first return, no channel reported a `sent` row. A
`notification_deliveries` row names a channel; here there is no channel to
name, so there is nothing a row could be attributed to.

At the second, the channels are named but disabled. A row against a disabled
channel would record an attempt that was never made, and the whole value of
this ledger is that *"no notification arrived"* and *"no notification was
attempted"* are different answers — a row here would give the wrong one.

Neither case is a refusal, which is the same distinction Amendment 4's ruling 2
drew when it left `dispatchToChannels`'s two pre-check exits alone. Those
refuse the **pairing** before `buildDedupeKey` has run, so no key exists for a
row to be attributed under. Here the key exists and the recipient does not,
which is the mirror image of that and lands in the same place: the `warn` is
the record, because there is nothing else to record.

**The two warns are distinguishable, and that is the operational point.** An
operator reading the log has to be able to tell "no channel holds a `sent` row
for this alarm" from "the recipients were disabled before the clear", because
the two ask for different actions. The first sends them to the rule's channel
list — and only if a channel is joined there at all, on to the raise path; the
second to the channel that somebody turned off. Each line carries the alarm id,
the rule code and its own case, and the unit spec asserts the discrimination
**in both directions** — exchanging the two strings is the mutation a "the two
differ" assertion would pass.

**What the first return covers: two readings, and it does not assume the raise
was ever offered.** `sentChannelIdsForAlarm` filters on `status = 'sent'`, and
an empty answer is reached by two quite different routes. They arrive at the
same return and the sweep cannot separate them there without a second read, so
the line is worded on the `sent`-row predicate rather than on "the raise never
landed" — and the amendment must not blur them either:

- **No channel was ever configured for this rule.** With no `rule_notifications`
  join the rule has no recipients, so the raise was offered to nobody and wrote
  no delivery row, and the read answers `[]` at every clear of that rule. This
  is not the rare shape: no seed writes `rule_notifications`, and ADR 0058
  decision 2 — *"a seeded rule carries `action = review` and joins no
  notification channel"* — makes `asset-templates-instantiate.service.ts`
  deliberately not write one either. On a seeded or a template-built database
  this is therefore the *usual* line. Nothing was offered, nothing vanished and
  nothing is owed: the warn says there is no channel to tell, which is the
  whole of what it claims.
- **The raise was offered and left no `sent` row.** If rows exist under the
  raise key but none is `sent` — a `failed` row, a `skipped_rate_limited` one, a
  `skipped_unconfigured` one newer than its watermark — then
  `runRaiseRetryPhase` is **still owed that raise** and may yet deliver it; the
  raise is not lost, and this warn must not be read as saying it was. If a
  channel is joined and there are nonetheless **zero** rows under the key,
  Amendment 5's ruling 3 evidence conjunct means that phase never re-offers it
  at all — "zero rows reads as 'not yet offered', not as 'owed'" — and then
  this warn is the only trace that episode leaves anywhere.

Read the line as its own words say it — *"no channel holds a sent row for it"* —
and not as "a message was lost". Under the first reading there was no episode
to lose.

**Not a contradiction of `channel-reads.ts`.** `loadEnabledChannelsByIds`'s
docblock says a disabled channel is silently absent, because an operator who
disabled it asked for exactly that. That sentence stands and the read is
unchanged. The **caller** now warns when the read answers with nothing at all,
which is a different fact: not "this channel was skipped" but "there is nobody
left".

**§9.6.** Each warn carries the alarm id and the rule code, and nothing else —
never the alarm message, never a channel id or code, never a channel's
configuration. The unit spec asserts each of those absences over both lines,
after first asserting that both lines exist, because a redaction assertion over
a warn that was never emitted passes on the empty string — with the caveat that
only two of the four are live today (the alarm message at both returns, the
channel ids at the second), because no channel row is in scope at either return
for a code or a configuration to leak from, so those two are forward guards on
the edit that loads one here.

**What gates it.** `alarm-lifecycle-cleared-no-recipients.spec.ts`, five
numbered assertions with one `it()` each per `F4.105`, and every absence paired
with a positive **on the same fixture**: "no dispatch" passes when
`notifyCleared` is never reached at all, so the first case asserts the recipient
read ran, the second asserts the channel read ran with the sent id — reachable
only past the first return — and each has a sibling fixture differing in one
option that does dispatch. It is its own file because
`alarm-lifecycle.service.spec.ts` stands at 801 of §4.5's 1000 lines and its
wrapper is a single `it()` over thirteen cases, where a mutation reddens
whichever case runs first rather than the one that owns the claim.
`alarm-lifecycle.service.ts` is at 991 lines after this change, four fewer than
the first draft of it: the reasoning above is carried here, and the call site
points at it rather than restating it. The next change to that file still
extracts before it adds.

**Not fixed, and named here so it is not re-filed as a gap.** A *partially*
disabled recipient set says nothing: the enabled channels are dispatched to,
the disabled ones are dropped by the read, and no warn is emitted, exactly as
before. Only the wholly-empty case speaks. A per-channel account of who was
dropped is a different row from this one, and it would have to carry the
recipient identities that §9.6 keeps out of these two lines.

## Amendment 7 — `F3.52`: a due escalation step can be too late to send, and the sweep is the thing that decides it (2026-09-09)

**Status: Accepted — 2026-09-09**, by the repository owner. The **nine** rulings
behind it are recorded in full in **ADR 0041 Amendment 6**, which is the
contract; this amendment exists so a reader of ADR 0057 alone is not left
believing the escalation phase sends every due step. The paired-amendment shape
is the one `F3.48`, `F3.51` and `F3.54` each used.

**Rulings 7, 8 and 9 arrived after this text was drafted**, from the review
passes, and two of them change what is written below rather than adding to it —
see "What the reviews changed" at the end. Read that section before the body.

### The escalation phase now decides an age, per step, every tick

`runEscalationPhase` iterates `dueSteps(steps, raisedAt, now)` and dispatches
each. Since `F3.48` a step the hourly ceiling refuses is re-asked on every 30 s
tick until it lands, so a step can stay due — and undelivered — for as long as
the channel's budget stays full. Nothing bounded that, and nothing told the
reader of an eventually-delivered step that it was old.

**A due step more than `STEP_MAX_LATENESS` past its own due instant is
abandoned.** The due instant is `raised_at + after_minutes` — the arithmetic
`dueSteps` already does — and the default bound is **60 minutes**, configurable
from the environment. Sixty is not arbitrary: it is `isOverHourlyLimit`'s own
trailing hour, so a step that could not fit inside one full ceiling window is
over budget rather than merely queued.

**`dueSteps` is unchanged.** The age question is a second, pure predicate beside
it — `stepIsTooLate` — rather than a widened return type. Decision 4's rule that
the sweep holds no state applies here too: the predicate takes `now`, the
alarm's `raised_at`, the step's `after_minutes` and the bound, and reads nothing
else.

### The step is still dispatched, and that is the load-bearing part

The phase does **not** skip a stale step in code. It marks the dispatch input
and dispatches as it always did, so the row is written by the path that writes
every other refusal — `dispatchToChannel`'s pre-check ladder — and there is no
second writer beside the private `record()`. A phase that simply `continue`d
would produce no send, no row and no evidence, which is the silent-loss shape
`F3.48`, `F3.54` and `F3.55` were each filed to remove.

The mark is an optional `stale?: true` on the **escalation variant only** of
`DispatchEvent`. Two consequences follow from that placement, and both are
deliberate:

- A raise, a re-offered raise and a cleared message **cannot** carry it. That is
  the type-level half of ruling 1's gate; the executable half is a
  positive/negative pair on one fixture, because an absence assertion alone
  passes when the action never happens.
- It must not reach `buildDedupeKey` or the message subject. A step's key stays
  `rule:alarm:severity:escalation:<n>` exactly as before, so the ledger rows a
  previous tick wrote under that key still match.

### What the abandoned row means, and how far it reaches

The abandonment records a new sixth delivery status, `skipped_stale`. Because it
is not `failed`, `eventDeliveryBlocked`'s existing arm blocks that key for the
life of the ledger with no new retry logic — which is exactly right: an
abandonment is a decision, not a postponement, and nothing lifts by itself the
way the hourly ceiling does.

**It must block that step and nothing else.** A step's key carries the
`:escalation:<n>` suffix, so the block is scoped to one step number for one
alarm and one channel. `channelsOwedTheRaise` reads the **raise** key, which has
no suffix, and excludes only `skipped_rate_limited` and a stale
`skipped_unconfigured` — so a `skipped_stale` row appearing under a raise key
would block that raise for ever. Ruling 1 keeps the raise path untouched and the
type placement above makes such a row unconstructible; the build gates it rather
than trusting the argument.

### What this does not change

- **Amendment 5's byte-identity on the raise-retry path stands.** The re-offered
  raise gains no age marker, no subject change and no key change. Amendment 5
  assigns `F3.52` "the retried message's lack of any age or staleness marker";
  ruling 1 declines that half here, because an age marker on the retried raise
  would break the byte-identity Amendment 5 calls the mechanism by which the
  ledger rows line up. It is **re-filed as its own row**, not silently dropped.
- **Decision 6 is untouched.** A cleared alarm still leaves the selection before
  the escalation phase sees it, so a stale step and a clear cannot race.
- **Amendment 6's out-of-scope note stands.** The escalation phase's silent
  `continue` over an empty channel list (`alarm-lifecycle-phases.ts:606`) is
  still deliberately untouched, and is a different case from this one: there the
  step has nobody to send to, here it has recipients and is simply too late.
- `MAX_EVENT_ATTEMPTS`, the unconfigured watermark, `F3.48`'s ceiling exception
  and `LostLedgerRows` all keep their present meanings. A lost `skipped_stale`
  row is remembered by `dispatchRememberingLostRows` exactly as any other.

### What the reviews changed (rulings 7, 8 and 9, 2026-09-09)

Three rulings landed after the body above was drafted. Two of them correct it.

**Ruling 8 — the reserve was charging raises against the event limit.** ADR 0041
Amendment 6 §1 shipped as "one count, two limits", and an unfiltered count
charges a RAISE against the reduced limit too: forty-eight sent raises an hour
refused every escalation step and every cleared message on that channel while
raises went on to the full ceiling. The reserve took from the path it exists to
protect, and a step held that long is exactly the step this amendment's age
cut-off then abandons — **the two halves of `F3.52` compounded a late delivery
into no delivery.** The fix is one query returning two counts, so events can
never occupy more than four fifths of the ceiling. The escalation phase is
unchanged by it; what changes is how often a step reaches the age bound at all.

**Rulings 7 and 9 — where the `skipped_stale` exit sits, and what that does not
buy.** The exit is the last pre-check in `dispatchToChannel`: after the ledger
read, and after the ceiling. It sat before the ceiling until the security
review, and the stated reason for moving it — that a step refused by the budget
could then never be abandoned for age it spent waiting — **is false, and is
recorded here rather than quietly reworded because it was believed and acted
on.** A correctness pass traced it: `stepIsTooLate` recomputes each tick from a
fixed `raised_at` and an increasing `now`, so once a step is stale it stays
stale; the moment the ceiling frees, control reaches the exit and the step is
abandoned after all. **The end state is identical in both orders.**

What the position does buy is the reason an operator reads while the channel is
over budget: `skipped_rate_limited` is true and self-clearing while it is true,
where `skipped_stale` would be terminal and premature. That is worth having, and
it is all it is worth.

**What this means for the age cut-off's own justification.** The row was filed
against steps "delivered with the same subject as a fresh one" after a long
deferral. That is still real, but ruling 8 removed the largest cause of the
deferral. After it, a step reaches the bound mainly when the TRANSPORT has been
failing for an hour — which is the case the cut-off was written for, and a
narrower one than the row assumed.

**Amendment 6's out-of-scope note still stands**, and the escalation phase's
silent `continue` over an empty channel list (`alarm-lifecycle-phases.ts:606`)
is still untouched.

## Amendment 8 — `F3.57`: the raise-retry phase gains the tick's clock, and the message it re-offers says how old the alarm is (2026-09-10)

Amendment 5 above gave the sweep its third phase and left the re-offered raise
byte-identical to the original — body included — recording the missing age
marker as `F3.52`'s to inherit. The reasoning and the correction to it are in
ADR 0041 Amendment 9; what belongs here is what changed inside the sweep.

**`RaiseRetryPhaseInput` gains a required `now: Date`.** The clear and
escalation phases have carried one since `F3.10`. This was the one phase that
needed no clock, and now it does. Required rather than defaulted to
`new Date()`, for the reason `F3.52` made `stale` required: a defaulted clock
would let the phase drift out of step with the sweep's own `now` and would still
compile, and every one of this repository's lifecycle decisions is asserted at a
fixed instant precisely so it does not depend on when CI happens to run. There
is exactly one construction site — `runLifecycleSweep`, which already holds
`now` — so the field costs one argument, and a mutation that passes `new Date()`
there reddens the sweep-level case and nothing else.

**`raiseRetryDispatchInput` gains `now` and composes the age.** It is the right
place because `LifecycleAlarm.raisedAt` is in scope there and nowhere further
down: `dispatchToChannels` composes no message text and, on this row's ruling,
must not start. The clause is suppressed below one whole minute, which is the
common case — the first re-offer lands one tick (30 s) after the raise.

**Decision 9 is untouched.** A re-offered raise still carries no `event`, so its
key is still the raise's own `rule:alarm:severity` and no kind is stored in a
column. The age is a property of the rendered message only; it reaches no ledger
reader, and `channelsOwedTheRaise` matches exactly the rows it matched before.

**What this does not fix, stated so the next reader does not assume it.** The
re-offer still cannot tell a recipient that a message was already delivered to
them, in the one case where that can happen — a transport that reports failure
for a message that landed. Nothing in the ledger distinguishes it, and this row
does not try.

## Amendment 9 — `F3.59`: the raise-retry phase reads a rule's channels only for an alarm that holds evidence (2026-09-10)

**What changed.** `runRaiseRetryPhase` paid `loadRuleChannels(candidate.rule.id)`
before it knew whether the alarm held any ledger row. The organization filter
that Amendment 5 put on the predicate's `rows` argument is now hoisted above
that read, the one hoisted array is handed to `channelsOwedTheRaise`, and the
candidate is skipped when the array is empty. The saving is exact rather than
approximate: `channelsOwedTheRaise` stage 1 answers `false` for every channel
whose row list is empty, so an empty group is "not owed" for **any** channel
list and the round trip could not change the answer. The skip is therefore
behaviour-preserving **for the owed set** by construction, not merely
conservative — and the qualifier is not pedantry, because both the correctness
and the compliance review asked for it independently. It is **not**
behaviour-preserving for the warn stream: a no-evidence candidate no longer
enters the per-alarm `try`, so a rejecting `loadRuleChannels` that used to warn
once per such candidate — 78 lines on the seeded fleet — now warns none. That is
an improvement and no message about an actually-owed channel is lost, but the
unqualified sentence was the kind of generalisation this row was asked to hunt.
Only the
organization is filtered at the guard — the status exclusions and the
unconfigured watermark stay inside the predicate, where the channel decides
them.

**What did not change.** The chunked ledger read, the per-rule channel memo, the
`read.unread` skip and the `channels.length === 0` exit all stay. Amendment 5's
four owner rulings are unchanged, and ruling 3 (the evidence conjunct) is *why*
the read was dead rather than something this row revisits. Decisions 9 and 10
are untouched. No DDL, no status vocabulary, no contract and no
`NotificationsService` change, so **ADR 0041 is not amended**; nothing in
`packages/shared` moves, so §4.8 and ADR 0030 do not apply.

**The measurement, cited rather than re-taken.** Taken inside `bms-api-1` as
`bms_fleet` over the docker network, which is the sweep's own role, host and
port. A first pass from the Windows host over published 5433 measured Docker
Desktop's proxy and is discarded.

| | ms, 5 samples |
|---|---|
| 78 sequential per-rule reads (the shape before this row) | 183 / 187 / 191 / 200 / 200 |
| 1 batched read over the same 78 rule ids | 2.5 / 3.1 / 3.5 / 3.8 / 4.1 |
| bare round-trip floor, 78 × `select 1` | 81 / 87 / 87 / 89 / 90 |

Fleet shape, as `bms_app` on the local seeded stack: **78** candidate alarms
over **78 distinct** rules — so the per-rule memo saves nothing here — **289 of
290** rules are `notify`, and **zero** rows in `notification_channels`,
`rule_notifications` and `notification_deliveries`. 190 ms is **0.63 %** of the
30 s tick (`LIFECYCLE_TICK_MS`). **This is this fleet's shape and not a law**:
the saving is one round trip per distinct rule, and only when every candidate of
that rule lacks evidence.

**The backlog row's own value sentence was false as an argument about the read,
and the row understated itself.** It said that for a rule with no
`rule_notifications` join "the phase already exits one line earlier, at
`channels.length === 0`". Line 468 paid the round trip and line 469 threw the
result away — the exit was *after* the cost. A rule with no join never
dispatches, so it never writes a delivery row, so its evidence group is always
empty, so the guard **does** save its read. Amendment 6 above and ADR 0058
decision 2 name the no-join rule as the deliberate seeded and template-built
shape rather than a misconfiguration, so the guard's value is **not**
configuration-dependent. The honest bound the other way: on a fleet where raises
send, an open alarm holds a `sent` row, the read is still paid, and the predicate
answers "not owed" after it. The guard saves the never-dispatched class and
nothing else.

**Owner ruling 1 (2026-09-10) — batching the channel read is declined here.** A
`ChannelsService.loadForRules(ruleIds)`, a change to `AlarmLifecycleDeps`,
chunking and a warn-and-return failure shape are a different defect on the same
line — round-trip count, not deadness — and new scope under AGENTS.md §10. It is
filed as its own backlog row. The two are independent: after this row a rule with
an evidence-bearing alarm still costs one channel query per distinct rule per
tick.

**The `read.unread` skip stays, and it now buys something else.** It is kept
because it is the only line that stops a blind re-offer of an *undecidable*
alarm if ruling 3's evidence conjunct is ever revisited: a ruling that read an
empty group as "owed" would turn this guard into a re-offer for every alarm whose
batch failed, which Amendment 5's R9 forbids in terms. What it buys today is
`RaiseAttemptsRead.unread`'s contract — "the caller must decide NOTHING about
these this tick" — stated at the one place that could violate it, not a channel
read: the guard reaches every alarm the skip reaches, because an unread alarm's
rows are in the batch that failed and its group is empty. That also cost the skip
its old gate. R16 asserted the saving on a fixture whose unread alarm holds no
row, so dropping the skip now leaves R16 **green**; R16's docblock says so rather
than keeping a mutation sentence that no longer holds. The skip's gate is R22, on
a read shape `loadRaiseAttempts` cannot produce — `raiseAttemptBatches` slices
the refs into disjoint batches, `selectBatch` binds `inArray(alarm_id,
batch.alarmIds)`, a failing batch adds all of its own alarm ids to `unread`, and
the phase builds exactly one ref per active alarm, so no alarm can be both listed
in `unread` and represented in `rows`. AGENTS.md §4.6 permits a sentinel stronger
than production and requires saying so; R22's docblock says it, and says a later
reader must not "fix" the fixture into a producible one.

**The authority for the two halves is not the same, and an earlier draft of this
paragraph claimed §4.6 for both.** §4.6's provision — under "Where a rule is held
is a claim about where its input exists" — authorises the **synthetic input**,
and R22 is squarely that shape. It does **not** authorise keeping a line whose
production effect is nil, which is the other half of the decision and which rests
on the defensive argument above: only that line would stop a blind re-offer if
ruling 3 were ever revised to read an empty group as "owed". The repository's
nearer precedent for the line itself is `LostLedgerRows.add`, which keeps a
branch no case reaches and says so in place of a test. The compliance review
caught this over-attribution, and it is recorded rather than quietly reworded
because the same slip — claiming a rulebook section for a decision the section
does not cover — is how a later reader inherits a rule that was never written.

**What gates it.** `alarm-lifecycle-raise-retry-evidence-guard.spec.ts`, cases
R20-R22 continuing the raise-retry file's numbering, with **one `it()` each**.
The new file exists for two measured reasons: the raise-retry spec stood at 905
of §4.5's 1000-line cap, and its wrapper is a single `it()` over nineteen cases,
where `assert` throwing means a mutation reddens whichever case runs first rather
than the one that owns the claim (`F4.105`). R20 holds both arms of the guard in
one assertion — no read for the rule whose only alarm holds no row, one read for
the rule whose alarm holds one — on two rules, because with both alarms on one
rule the memo would hide the saving. R21 holds that the group is filtered by the
**ref's** organization, and is the only case with its own `it()` that reddens
for either mutation that widens it: `rowsByAlarm.has(candidate.alarm.id)`, which
nothing else in the suite catches at all, and a filter on
`candidate.alarm.organizationId`, which also reddens R1 — but as the first case
of that single `it()`.

**A false green the correctness review found, and it is the most useful thing to
come out of this row.** The guard's comment said the status exclusions and the
unconfigured watermark stay inside the predicate "(case R21 gates both)". R21
gates **neither** — both of its ledger rows are `failed`, so neither exclusion is
engaged — and worse, the `skipped_rate_limited` exclusion was gated by **nothing**
at sweep level. `alarm-lifecycle-closed-ceilings.spec.ts` only *asserts* that
status as an outcome, and integration I2's ledger ends at `failed` because
`F3.53`'s closed-ceiling memo means a refused tick writes no row at all. So a
later author reading that comment as an invitation and hoisting the exclusions —
`.filter((row) => row.organizationId === … && row.status !== "skipped_rate_limited")`
— would have shipped **green** through every case in the new file, R1-R19, all
three integration cases and `raise-retry.spec.ts`, while silently un-fixing the
third of Amendment 5's three cases: a raise refused by the hourly ceiling has
`skipped_rate_limited` as its only row, stage 1 must read that as evidence with
an empty eligible set and answer "owed" (`blocked` is `0 >= 3 || [].some(…)`,
false), and the mutated guard drops the row before the predicate sees it.

**Fixed without a new case**: R20's evidence row is now
`skipped_rate_limited` rather than `failed`, which makes R20 the only sweep-level
gate on that exclusion, and its docblock says the status is load-bearing so a
later reader does not tidy it back. The comment now points at the three cases that
actually gate its three claims — R21 for the organization axis, R5 for the
watermark (its only evidence is `skipped_unconfigured`), R20 for the rate-limited
exclusion — because naming one case for all three was the false sentence.

**Eight mutations were run and their printed messages recorded, not reasoned
about.** Seven were killed, each by the assertion that owns its claim: the guard
deleted (R20 assertion 2, `got [rule-1,rule-2]`); the guard skipping
unconditionally (R20 assertion 2, `got []` — and R21, R22, R1 and all three
integration cases with it); the unfiltered `has` (R21 only); the predicate handed
the unfiltered group while the guard uses the filtered one (R2, `one re-offer,
got 0`, which is what makes the hoist a hoist and not a second filter); the
`read.unread` skip deleted (R22 only, R16 green — the finding above, measured);
the alarm's own organization (R21 and R1); and the `catch` assigning an empty
read that carries the cause instead of returning (R9's warn COUNT, two warns).
**The eighth survives and is recorded rather than repaired**: a `catch` that
assigns an empty read and discards `reasons` leaves all seven tests green, and
after this guard that is a behavioural equivalence rather than a hole — an empty
read decides nothing about anybody, which is exactly what the `return` does. R9's
docblock states it, so a later reader does not take the green as coverage.

What no unit case can prove is stated in the file: the
fakes count calls and hold no connection, so nothing there is evidence about a
round trip. `alarm-lifecycle-raise-retry.integration.spec.ts` is unchanged and
was run **with** the database attached — 3 files, 7 tests, **0 skipped** — where
without one its three cases skip. I1-I3 all hold rows under the key, so the guard
never fires there; that is the regression check, not a gate on the guard.

**The database-level check ran on the stack, and both halves are recorded here.**
`pg_stat_all_tables` scan counts, taken as
`bms_app` — a pure read with no configuration change, which replaces a planned
`ALTER SYSTEM SET log_min_duration_statement = 0`: this Postgres is shared with a
second session, and statement logging would pollute their window and persist in
`postgresql.auto.conf` if a reset were missed. **Before**, on `144ce8cb`:
`bms.rule_notifications` 517380 → 517614, delta **+234**, which is 78 × 3 ticks
and so the 78 distinct candidate rules exactly; `bms.notification_deliveries`
104174 → 104177, delta **+3**, one ledger read per tick and the positive control
that the sweep is alive. **After**, on the rebuilt image over a 100 s window:
`bms.rule_notifications` 524526 → 524526, delta **0**; `bms.notification_deliveries`
104910 → 104914, delta **+4**; `bms.alarms` 108882 → 108886, delta **+4**. So
**78 channel reads a tick became none**, and the two non-zero deltas are the
positive controls that four ticks genuinely fired — the zero is the guard, not a
dead sweep. Each window's tick count is read off the `notification_deliveries`
delta rather than divided out of the window length, which is why "before" is
three ticks and "after" is four.

**The container was proved to carry the change before anything was read from
it**, because a worktree build has served `main`'s code in this repository
before: a `--no-cache` build with the worktree as context, the guard's
`evidence.length === 0` present in the new image's
`dist/alarms/alarm-lifecycle-phases.js` and **absent** from the pre-change image
as a negative control, and the running container's image id identical to the
newly built one. No log line is expected or found for the skip itself — the guard
writes none by design, which is why the scan counters carry this claim.

**Caveat for whoever reads it**: the same Postgres is shared with a second
session, so a non-zero `rule_notifications` delta is not automatically a failure
of the guard; correlate it against the tick count before concluding.

**Browser — N/A**, and said rather than skipped silently: no rendered surface, no
`apps/web` change, no bundle to reload.

**Prose corrected, because the guard made it false.** R9's assertion message
("would cost a channel read per rule") and its docblock, which now records that
the assertion no longer distinguishes the `return` from a carry-on with an empty
read; R16's docblock mutation sentence; the phase docblock's per-tick read cost
and its memo comment; the `read.unread` comment; and `raise-attempts.ts`'s "cost
**78**", which is dated to before this row and now records that on that fleet the
guard skips all 78. The phase docblock's spec census also went stale by
construction — a seventh suite and three more sweeps — and was re-counted with
the command that docblock carries. Still owed to the separate `chore(agents):`
sweep, and deliberately not touched on the feature branch (§9.10): the
`F3.59` BACKLOG row's own false value sentence and its `⬜` status; three stale
`docs/roadmap.md` sites (the "filed, unbuilt" entry and two calling `F3.59` the
only remaining Wave-2 Track D row); `AGENTS.md`'s "477 and 728" line counts, the
phases file now standing at **795** — re-measure it rather than copy that figure,
which is what the `AGENTS.md` sentence itself says and which this row proved
right by going stale twice inside one branch; an Amendment 9 summary in the §2 *Alarm
lifecycle* row; and **the new batching backlog row from owner ruling 1**, which
does not exist yet and is the easiest of these to lose.

**One correction to this list, which an earlier draft of it got wrong.** It said
the roadmap carried a *mirror* of the BACKLOG row's false sentence. It does not:
the roadmap says "the loop exits at `channels.length === 0`, so
`channelsOwedTheRaise` is never reached", and that is **true** — the predicate
really is never reached for a rule with no join. Only the *cost* precedes that
exit, which is the half the BACKLOG row gets wrong. The roadmap owes a status
flip, not a correction.

**What this does not fix.** A rule with at least one evidence-bearing alarm still
costs one channel query per distinct rule per tick, and on a configured fleet
that is most of them. That cost is the filed batching row's, not this one's.
