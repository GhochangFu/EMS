# ADR 0064 — Scheduled rule evaluation as a BullMQ repeatable job on the worker

## Status

Accepted — drafted and ruled 2026-09-11 under `F3.11`. The four scope questions
(shape, broadcast path, write policy, cadence) were put to the owner and ruled
that day, each as drafted; the owner approved the record as a whole the same
day, before any implementation code (AGENTS.md §10, `backlog-cycle` step 2).

## Context

`F3.11` (Track D, Wave 1, P1 — *"Scheduled / cron rule evaluation (BullMQ
workers)"*) became eligible on 2026-09-11 when `F4.24` landed the queue and the
worker process under ADR 0063. That ADR names `F3.11` three times and each time
leaves it behind its own row: the queue's first consumer, the split it forces,
and the executions it acts on are *"those rows' own ADRs"*. AGENTS.md §6 still
lists *"scheduler/job queues"* as deferred until *"their specific sprint is
promoted"*. This is that promotion for scheduled rule evaluation only.

Six things are true of the repository today, each read from source on
2026-09-11 rather than assumed.

**1. Rules are evaluated on two paths, and neither is scheduled.** The
streaming engine (`alarms/alarm-engine.service.ts`, ADR 0033) evaluates
threshold rules on every telemetry batch the `LISTEN bms_telemetry` client
fans out — it never sees a point that has stopped sending, and it never
evaluates a `time_window` rule at all. The on-demand sweep (`POST
/api/v1/rules/evaluate`, `RulesService.evaluateEnabledRules`) walks every
enabled, published rule from every tenant on the fleet pool, but only when a
human with a `configuration` write role presses "Evaluate now", and `F3.47`
bounds that button per organization at the route. A rule on a manual-entry
point, a stale meter, or a time window is therefore evaluated only when
somebody remembers to press it. `docs/zoho-iot-gap-analysis.md` §"Alarms &
Rules" records *"Scheduled/cron evaluation — Missing — Priority High"*.

**2. The two paths carry different write policies, and only one of them was
designed for a loop.** The streaming engine dispatches a notification and
records a `bms.rule_executions` trace **only on a transition** — `raised:
true` from `AlarmRaiser.raise`, which is `alarms_open_per_rule_uidx` finding no
open alarm (ADR 0033 decision 3; `F3.7` owner ruling Q2, 2026-09-06). The
on-demand sweep is the asymmetric half by design: it inserts one trace row per
rule per press whether or not it matched, and every *attempted* raise
dispatches, so a repeat press records one `skipped_deduped` delivery row per
channel — *"which answers 'I pressed Evaluate now, why was nobody told?'"*.
`F3.46` measured that shape growing `bms.notification_deliveries` and bounded
it once per key (ADR 0041 Amendment 2). The engine's own comment puts the
alternative at *"35,400 ledger rows an hour per channel"* for five batches a
minute against 118 open rules. A sweep every minute inheriting the on-demand
policy would write on the order of `rules × 1440` trace rows a day on a quiet
plant — 337 seeded rules is ~485k — into a table with no retention policy.
That number is arithmetic, not a measurement; decision 5 sits inside the
constraints rather than on the estimate.

**3. The worker's fence forbids the modules, not the services.**
`tests/f4.24-worker-imports-no-api-loop.test.ts` (ADR 0063 decision 3,
Amendment 1) walks the relative import closure of `apps/api/src/worker.ts` and
reddens if it reaches any of fifteen files: the six `onModuleInit` loop sites,
the two loop hosts, **five module files by path** (`alarms/alarms.module.ts`,
`calc/calc.module.ts`, `asset-health/asset-health.module.ts`,
`telemetry/telemetry.module.ts`, `rules/rules.module.ts`), `app.module.ts` and
`main.ts`. `RulesModule` imports `AlarmsModule` imports `TelemetryModule`, so
importing it is what ADR 0063 said would *"force the split then, under that
row"*. The same walk run on 2026-09-11 over the **services** instead:
`rules/rules.service.ts` (48 files), `alarms/alarm-raise.service.ts` (15),
`notifications/notifications.service.ts` (23), `notifications/
notifications.module.ts` (31) and `vocabularies/vocabularies.module.ts` (7)
each reach **none** of the fifteen. So no service moves. What is missing is a
Nest module that provides the evaluation services without importing the
loop-bearing modules that provide them today.

**4. One hard edge: the alarm broadcast is process-local.** `AlarmRaiser`
(`alarms/alarm-raise.service.ts:267`) calls
`AlarmsGateway.broadcastCreated`, and `AlarmsGateway.emitScoped`
(`alarms/alarms.gateway.ts:83`) iterates `this.server.sockets.values()` — the
Socket.IO sockets **connected to this process** — and emits to each whose
`assetIds` scope admits the alarm. The `@socket.io/redis-adapter` in
`realtime/redis-io.adapter.ts` fans out room broadcasts across processes; a
per-socket `client.emit` is not a room broadcast and does not cross it. Two
consequences. The worker has no Socket.IO server at all, so an alarm it raises
reaches no screen until the next `GET /alarms`. And — pre-existing, measured
from the same loop — an alarm raised on `api-replica` (a streaming raise, an
on-demand press, a lifecycle `cleared`) never reaches a socket held by `api`,
and vice versa. The second is not this row's defect; decision 4 fixes the
`created` case as a side effect and `F4.133` records the rest.

**5. The queue registry already has everything a repeatable sweep needs.**
`defineQueue` (name, tenancy, Zod payload, retry policy), `upsertSchedule`
(BullMQ's job scheduler, `{ every }`, no `jobId` — the scheduler id is the
identity), `runProcessor` (parses the payload, opens the tenant or fleet
transaction), `startQueueWorkers` (`concurrency: 1`, the outcome counter),
`readWorkerConfig` (fail-closed env parsing, `QueueConfigError`), the
per-queue `waiting`/`active`/`failed` depths on both `/health` endpoints and
`bms_queue_depth` / `bms_queue_jobs_total` on `/metrics`. The heartbeat is a
60 s repeatable job with a fixed scheduler id, *"the exact primitive `F3.11`
will build on"* (ADR 0063 decision 10). The worker service in
`docker-compose.yml` already carries the three pools and the three
`CREDENTIAL_ENCRYPTION_KEY*` variables *"so the day dispatch moves to the
worker … is a code change, not a compose change"*. ~~The notification
transports read their SMTP settings from the encrypted channel row, not from
the environment, so dispatch from the worker needs no compose change.~~
*Corrected by Amendment 1: the transports read `SMTP_*` from the process
environment (`notifications.config.ts:97-105`); the conclusion holds for a
different reason — compose sets none of them on `api` either, and
`tests/adr-0041-notification-invariants.test.ts` forbids an `SMTP_HOST` line.*

**6. `AlarmRaiser.raise` is already idempotent on its own row.**
`alarms_open_per_rule_uidx` makes a second raise of an open alarm return
`raised: false` with the existing alarm, and `recordTrace` defaults to a
trace-on-raise-only write. ADR 0063 decision 5 requires every processor to be
idempotent on its own row because a job id de-duplicates only while the
earlier job is retained; the sweep's row is the alarm, and it already is.

## Decision

1. **Shape: one fleet-wide sweep, not a per-rule schedule** (ruled, Q1). A
   BullMQ repeatable job on the worker evaluates every enabled, published rule
   of every tenant — the same set `POST /rules/evaluate` walks
   (`selectRuleRows` on the fleet pool, filtered `enabled &&
   lifecycleStatus === "published"`), with the same one-query sample batch
   (`batchedLatestPointValues`) and the same evaluators
   (`evaluateThresholdRule`, `evaluateTimeWindowRule`,
   `unsupportedRuleType`). No column is added to `bms.automation_rules`; no
   cron grammar; no rule-builder field. A per-rule schedule is a later row
   that depends on this one, if a client asks for it.

2. **One queue, `rules-sweep`, declared once, fleet tenancy, empty strict
   payload.** `defineQueue({ name: "rules-sweep", tenancy: "fleet", payload:
   z.object({}).strict() })`, appended to `ALL_QUEUES` in `queue/queues.ts`.
   Fleet because the read is cross-organization by design (ADR 0033 decision
   2, E7.1b) — the per-rule writes then run under each rule's own tenant GUC
   through `withTenant`, exactly as `evaluateEnabledRules` does today. One
   scheduler, id `rules-sweep`, upserted by the worker at boot beside the
   heartbeat's. Retry policy: `RETRY_DEFAULTS` — a sweep that throws is
   retried on backoff and its failure is counted in
   `bms_queue_jobs_total{queue="rules-sweep",outcome="failed"}`; the next
   scheduled tick runs regardless.

3. **A loop-free `RuleSweepModule` in `apps/api/src/rules/`, imported by
   `WorkerModule` and by nothing that starts a loop.** It provides a new
   `RuleSweepService` — the sweep body — and imports `DatabaseModule`,
   `NotificationsModule` and a new loop-free `AlarmRaiseModule`
   (`apps/api/src/alarms/`) that provides and exports `AlarmRaiser`.
   `AlarmsModule` imports `AlarmRaiseModule` instead of providing
   `AlarmRaiser` itself; `RulesModule` keeps importing `AlarmsModule` and is
   otherwise untouched. `RulesService.evaluateRule` (today private) moves to
   `rule-evaluation.ts` as an exported function both services call, so the
   sweep and the on-demand press cannot drift on what "evaluate this row"
   means. `tests/f4.24-worker-imports-no-api-loop.test.ts` stays green by
   construction — the new modules reach none of the fifteen — and its
   `WORKER_LEAVES` list gains the two new module files so the positive
   control names them. **A worker whose closure reaches `RulesModule` or
   `AlarmsModule` is a defect, not a shortcut**; the test is the gate.

4. **Broadcast: Postgres `NOTIFY bms_alarms`, and the gateway emits from
   `LISTEN`** (ruled, Q2). `AlarmRaiser` stops calling `AlarmsGateway`
   directly. `raise` already runs the dedupe insert, the read-back and the
   trace inside **one** `withTenant(asset org)` transaction and defers the
   broadcast until after commit (`alarm-raise.service.ts:207–267`); the
   `pg_notify` rides in that same transaction, as the last statement after
   the trace insert, with a payload of `{ "type": "created", "alarmId":
   "<uuid>", "organizationId": "<uuid>" }` — ids only, never the alarm body,
   well under the 8000-byte limit and inside the `MAX_NOTIFY_UTF8_BYTES`
   discipline of ADR 0016 §2. Postgres delivers a transactional `NOTIFY` on
   commit and drops it on rollback, so a refused raise notifies nobody and a
   listener never reads an id before the row is visible. In the API, a new
   `AlarmNotifyService` in `AlarmsModule` runs a `LISTEN bms_alarms` client on
   the `telemetry-listener.ts` loop shape (`F4.34`: error handler, bounded
   reconnect, backoff reset on the first delivery), reads the alarm by id on
   the fleet pool through `alarmListItemColumns`, and calls
   `AlarmsGateway.broadcastCreated`. Every API process listens, so a `created`
   raised on the worker, on `api` or on `api-replica` reaches the sockets of
   both API processes. `AlarmRaiser` loses its `AlarmsGateway` dependency,
   which is what lets `AlarmRaiseModule` be loop-free without a fake gateway.
   Six existing specs construct `AlarmRaiser` with a fake gateway at nine
   sites — `alarm-raise.integration.spec.ts`,
   `alarm-raise.service.rls.integration.test.ts`,
   `alarm-engine.integration.spec.ts`, `alarm-lifecycle.integration.spec.ts`,
   `rules/evaluate-enabled-rules.integration.spec.ts` and
   `rules/rules.service.rls.integration.test.ts`. ~~Some assert
   `broadcastCreated` on raise; each moves its assertion to the
   notification.~~ *Corrected by Amendment 1: none asserts it — every stub is
   a no-op — so each site drops one constructor argument and nothing moves.*
   The `NOTIFY`-reaches-the-gateway claim gets its own integration spec.
   `acknowledged` and `cleared` keep their direct emits; moving them onto the
   same channel is `F4.133`. No new package (AGENTS.md §9.4): `pg` already
   carries `LISTEN`, and *"a channel name is not a schema object"* — no grant,
   no migration.

5. **Write policy: the streaming engine's, not the on-demand press's**
   (ruled, Q3). The sweep raises through `AlarmRaiser.raise` with its default
   `recordTrace` (a `bms.rule_executions` row only when an alarm is actually
   raised — ADR 0033 decision 3) and dispatches through `notifyOnRaise` **only
   when `raised.raised` is true** (the engine's transition rule, `F3.7` Q2). A
   matched rule whose alarm is already open writes nothing and tells nobody.
   The trace `AlarmRaiser` writes today is `{ assetId, alarmId, raisedBy:
   "alarm_engine" }`; `raise` gains a `raisedBy` option, the engine keeps
   `"alarm_engine"` as its default, and the sweep passes `"rule_sweep"` — so
   an operator reading "why did this alarm fire" can tell a sweep raise from
   a streaming one, and from a press (whose trace carries `evaluatedBy`).
   No `evaluatedBy` on a sweep trace: nobody pressed anything.
   `isSampleFreshEnoughToRaise` bounds a sweep raise
   exactly as it bounds an on-demand one: a stale match is a trace-less
   no-op. `last_evaluated_at` is stamped **once per sweep in one `UPDATE …
   WHERE id = ANY($1)` per organization** under that organization's GUC, not
   one statement per rule. The on-demand press keeps its own policy
   unchanged; ADR 0033 decision 2's "unscoped raise, scoped return" has no
   return here to scope.

6. **Cadence: `RULE_SWEEP_INTERVAL_MS`, default `60000`, floor `10000`,
   ceiling `3600000`, fail-closed** (ruled, Q4). Read by `readWorkerConfig`
   beside `REDIS_URL` and `WORKER_PORT`; a value outside the range, or one
   that is not an integer, is a `QueueConfigError` and the worker refuses to
   start (ADR 0063 decision 9's shape). There is no "off" value — a deployer
   who does not want scheduled evaluation does not run the worker profile,
   and a queue with no consumer is the failure decision 12 of ADR 0063
   exists to avoid. The default matches the health roll-up's cadence; the
   streaming engine still answers live telemetry within a batch, so the sweep
   is the safety net behind it, not the primary path.

7. **The sweep is one job at a time, and a slow sweep delays the next tick
   rather than overlapping it.** `startQueueWorkers` runs `concurrency: 1`,
   and BullMQ's scheduler adds the next iteration only when the worker takes
   the current one (ADR 0063, *Recorded, not changed*) — the same guarantee
   `scheduling/sweep-loop.ts` gives the in-process loops. A second worker
   replica would still not overlap on this queue (one scheduler id, one job
   in flight), but it would double-consume any future queue whose jobs are
   not idempotent; that stays `docker-compose.yml`'s recorded caution and is
   not answered here.

8. **Observability: two things, on the surfaces that exist.** The worker's
   and the API's `GET /health` queue section gain the `rules-sweep` depths for
   free; the worker additionally writes the last completed sweep's
   `{ finishedAt, evaluated, raised, durationMs }` to one Redis key under the
   `bms` prefix, read into `/health` as `lastRuleSweep` beside
   `lastHeartbeatAt`. `/metrics` gains `bms_rule_sweep_duration_seconds`
   (histogram) and `bms_rule_sweep_raised_total` (counter); the queue-level
   counters already cover completed/failed. One `info` log line per sweep
   with the same three counts — never a rule code, never a value (§9.6).

9. **What the sweep does not do.** It does not evaluate rules whose type
   neither evaluator handles (`unsupportedRuleType` traces nothing, as
   today). It does not raise for a rule with no `organizationId` (skipped with
   the same warning as the press). It does not touch the `F3.47` throttle —
   that bound is on the route, for humans, and the sweep is not a caller of
   the route. It does not replace the streaming engine or the button.

## Dependencies

None new. `bullmq` is ADR 0063's; `pg`'s `LISTEN`/`NOTIFY` is ADR 0002's and
`F4.34`'s. No schema change and no migration: `raisedBy: "rule_sweep"` lives
in the `rule_executions.trace` JSONB column, which carries no CHECK, and a
`NOTIFY` channel is not a schema object.

## Consequences

- **What this promotes.** "Scheduled rule evaluation" leaves AGENTS.md §6's
  *"scheduler/job queues"* deferral in a separate `chore(agents):` PR (§9.10),
  together with the `docs/roadmap.md` line, once the row closes. The generic
  deferral stays for anything that is not this queue.
- **What this unblocks.** Nothing on the board lists `F3.11` in `Depends`. It
  is the first real consumer of the queue after the heartbeat, and the module
  split (decision 3) is the shape `F3.12` and the ADR 0041 dispatch follow-up
  reuse — each stays its own row.
- **What it uncovers and does not own.** `F4.133` (filed in `docs/BACKLOG.md` with this ADR, Wave 2, P2, `Depends: F3.11`):
  `acknowledged` and `cleared` are still per-process emits, so an
  acknowledgement made through `api-replica` reaches no socket held by `api`.
  Decision 4 leaves the channel and the listener in place for that row to
  extend.
- **Effort.** The board's 4 weeks predates ADR 0063 and the closure walk in
  Context 3, which is what changes the shape: no service moves, and the queue
  primitives exist. What remains is the two modules, the listener, the sweep
  body, the config field, the health/metrics surface and their gates. The
  row's Effort cell is corrected when it closes, with the measured figure,
  not with an estimate here.
- **Volumes are to be measured, not estimated.** The closure row records, from
  the running stack: sweep duration against the seeded 337 rules, the
  `rule_executions` and `notification_deliveries` row counts after one hour
  of sweeps on a quiet plant (expected: zero growth), and the `pg_stat_activity`
  backends the worker now opens (it opened none under `F4.24`; it opens some
  now, by design).
- **Deferred.** Per-rule schedules (Context 1); a retention policy for
  `bms.rule_executions` (ADR 0033 decision 3, still not justified by traffic
  under decision 5); moving `acknowledged`/`cleared` to `NOTIFY` (`F4.133`);
  a second worker replica (decision 7).

## Amendment 1 — the worker's module graph, the listener seam, and three corrections (2026-09-11)

Raised by the step-3 plan (`docs/plans/f3.11-scheduled-rule-evaluation.md`
§2, §17) the same day the record was accepted; ruled by the owner as a
package, with two further rulings beside it. Nothing here changes decisions
1, 2, 5, 6, 7 or 9.

**A1. Decision 3's module list could not boot in the worker as written.**
`NotificationsModule` declares three controllers, each `@UseGuards(JwtAuthGuard)`
(`notifications.controller.ts:54`, `escalation-profiles.controller.ts:50,92`);
`JwtAuthGuard` injects `JwtService` (`jwt-auth.guard.ts:115`) from the
`JwtModule.register({ global: true })` that only `AuthModule` loads
(`auth.module.ts:11-18`); and `ChannelsService` injects `AccessControlService`
(`channels.service.ts:189`), provided only by `@Global() AuthModule`
(`auth.module.ts:21`). A `WorkerModule` that imports `NotificationsModule`
without `AuthModule` fails DI at boot; one that imports `AuthModule` mounts
`/auth`, `/notifications` and `/admin/escalation-*` on `WORKER_PORT` — a
host-published port — without `main.ts`'s global `ZodErrorFilter` and `api/v1`
prefix, on the `dev-only-change-me` JWT fallback. **Refused.** Decision 3
gains two provider-only carves, no behaviour change: `auth/access-control.module.ts`
(`@Global`, provides and exports `AccessControlService`; `AuthModule` imports
it) and `notifications/notifications-core.module.ts` (the providers of
`NotificationsModule` minus `EscalationProfilesService`, no controllers,
exports `NotificationsService` and `ChannelsService`; `NotificationsModule`
imports and re-exports it). `RuleSweepModule` imports `AlarmRaiseModule` and
`NotificationsCoreModule`; `WorkerModule` imports `AccessControlModule` and
`RuleSweepModule`. The fence gains **rule 6**: the worker's import closure
holds exactly two controllers, `health/health.controller.ts` and
`observability/metrics.controller.ts` — so importing either full module
reddens by name.

**A2. Decision 4's listener is an extraction, not a copy.** "On the
`telemetry-listener.ts` loop shape" is discharged by moving the `F4.34` loop
(`telemetry-listener.ts:128-339` — the `error`-before-`connect` order, the
abort-listener removal, the stable-window backoff reset) to
`database/notify-listener.ts` with `channel` and `onNotification` as
parameters; `createTelemetryListener` becomes an adapter over it. The gate is
`telemetry-listener.spec.ts` and `telemetry-notify.service.ts` **unchanged,
byte for byte, and green**. `database/notify-listener.ts` and
`alarms/alarm-notify.ts` join the fence's loop hosts; `alarms/alarm-notify.service.ts`
joins its loop sites.

**A3. Decision 8 gains two metrics.** `bms_api_alarm_listener_connected`
(gauge) and `bms_api_alarm_listener_reconnects_total` (counter), mirrored from
`F4.34`'s telemetry pair. Before this ADR an `api`-side raise reached `api`'s
own sockets with no listener in the path; after it, every `created` on a
screen depends on `LISTEN bms_alarms` being up, and the reason `F4.34` gave
for the telemetry gauge applies verbatim.

**A4. Decision 5's stamp is `last_evaluated_at` only** (ruled). The press
also bumps `updated_at` (`rules.service.ts:743`); a sweep every minute doing
the same would make every rule read "updated one minute ago". The press keeps
its own behaviour.

**A5. The worker does not refuse to boot on a missing credential key**
(ruled). ADR 0063's Consequences owed the worker a boot refusal "the day it
first decrypts anything"; this is that day (a webhook secret on dispatch).
The API refuses nothing on a missing `CREDENTIAL_ENCRYPTION_KEY` — a delivery
reads `skipped_unconfigured` (`notifications.config.ts:121-158`) — and the
ingest host warns and falls back. A worker that refused while `api`
dispatched would turn an optional key into an outage of scheduled
evaluation. Parity with `api`; the sentence in ADR 0063 is discharged by this
ruling, not by a refusal.

**A6. Two sentences in the accepted text were false and are struck above.**
Context 5 said the transports read SMTP settings from the channel row; they
read `process.env` (`notifications.config.ts:97-105`). The conclusion — no
compose change — holds because compose sets none on `api` either and
`tests/adr-0041-notification-invariants.test.ts` forbids it; `docs/env-inventory.md`
records that a deployment which sets SMTP on `api` must set it on `worker`.
Decision 4 said some raiser specs assert `broadcastCreated`; none does.
