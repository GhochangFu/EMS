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
