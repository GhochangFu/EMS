# ADR 0057 — Alarm lifecycle: auto-clear on normal and escalation profiles

## Status

**Proposed** — drafted 2026-09-06 for `F3.10` (Track D, P1, Wave 1,
`Depends: F3.6 ✅, F3.8 ✅`). Five design rulings were taken by the repository
owner in chat on 2026-09-06, all as recommended, and the four design sections
below were approved one by one the same day. The ADR waits on the owner's
step-2 acceptance (AGENTS.md §10) before `plan-architect` writes the plan; no
implementation code exists. Effort is re-set from `4–6` to **`8–10`**
(decision 12).

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
