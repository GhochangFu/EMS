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
