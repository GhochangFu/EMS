# ADR 0127 — Device health: last-seen, drop history, ingest heartbeat and comms-loss alarms (`F3.16`)

## Status

**Accepted — 2026-11-11** (owner, in chat: "accept ADR 0127, yes build the
plan, no e2e"). **Built 2026-11-11:** PR A
[#1270](https://github.com/GhochangFu/EMS/pull/1270) (visibility) and PR B
(device alarms). Drafted by an agent for backlog row `F3.16` (P1, Wave 2). The
owner ruled sixteen questions on 2026-11-11, one at a time, and chose the
recommended option on Q2–Q16. On Q1 the owner chose to keep the comms-loss
alarm in this row, and kept it there again when told it raises the size to
about 10–12 days. The owner also ruled that the backlog `Depends` (`F1.x`) is
met by `F1.1`, `F1.7` and `F1.10`. Every ruling is recorded under *Decision*
and *Owner rulings*. The plan is
[`docs/plans/f3.16-device-health.md`](../plans/f3.16-device-health.md); the
owner approved it the same day, with no `e2e` label on either PR.

No npm package is added, so AGENTS.md §9.4 does not apply. This ADR amends:

- [ADR 0075](./0075-system-status-and-data-quality.md) decision 3: the
  `field_data` component reads a real heartbeat.
- [ADR 0061](./0061-ingest-receive-time-and-device-time.md) decision 3:
  `device_time` gets its first reader (clock skew).
- [ADR 0033](./0033-alarm-engine-unification.md) and
  [ADR 0057](./0057-alarm-lifecycle-auto-clear-and-escalation.md):
  `bms.alarms` may hold an alarm with no rule and no asset. `AlarmRaiser`
  stays the one raiser, and the lifecycle sweep the one writer of
  `cleared_at`.
- [ADR 0043](./0043-multi-tenant-architecture.md) decision 5: two platform
  tables carry no `organization_id`.
- [ADR 0063](./0063-bullmq-job-queue-and-worker-process.md): one more queue.

ADR 0016 Amendment 8 (`F4.61`) is unchanged: the ingest health page stays
container-local.

## Context

Read from `main` at `037e0fa8`:

- **Drop counters reach only the log.** `SampleCounters`
  (`apps/ingest/src/host/normaliser.ts:93-138`) has six drop buckets, summed by
  `droppedCount` (`:176`). `resolveSamples` (`:330`) counts per batch, not per
  device, and names a point only for a duplicate (`firstDuplicate`, `:137`).
  `apps/ingest/src/main.ts:228` logs `samples discarded` with the endpoint and
  the counts. The edge receiver folds all six into `unresolved`
  (`uplink-receiver.ts:199-200`). Nothing persists them; ADR 0056 decision 4,
  ADR 0061 decision 6 and ADR 0016 all hand the operator-facing surface to
  `F3.16`.
- **Last-seen is process memory.** The supervisor keeps `lastSampleAt` per
  endpoint and per device (`supervisor.ts:287,366,384`); the container-local
  health page is its only reader. `bms.rtus` has no last-seen column
  (`packages/db/src/schema/bms-schema.ts:199-229`). The one persisted
  last-seen is `edge_gateways.last_seen_at` (`uplink-write.ts:103`).
- **`device_time` is written and unread** (ADR 0061 decision 3).
- **`field_data` is inferred** from asset freshness
  (`apps/api/src/system-status/system-status.ts:48-56`,
  `system-status.service.ts:122`), a limit ADR 0075 accepted "until `F3.16`".
- **The freshness window** is `clamp(ceil(2.5 × interval), 25 s, 900 s)`
  (`apps/api/src/telemetry/telemetry-cadence.ts:18-46`); the interval is
  `rtus.expected_interval_seconds` (migration `0138`), else the learned median
  (`learnedIntervalsCteSql`, `:61`, private to that module).
- **The ingest host connects as `bms_fleet`** (`docker-compose.yml:687`), a
  stopgap; a dedicated `bms_ingest` role is owed (`:678-686`) and exists in no
  migration. `0041:112` grants `bms_tenant` all four verbs on every new `bms`
  table by default.
- **An alarm is keyed on an asset and a rule, end to end.**
  `alarms.asset_id` is NOT NULL (`alarms-schema.ts:53-55`). The dedupe is
  `alarms_open_per_rule_uidx (asset_id, rule_id) WHERE cleared_at IS NULL AND
  rule_id IS NOT NULL` (`0066_alarm_lifecycle.sql:210-212`). Every list read
  inner-joins `bms.assets` (`alarm-list-item.ts:116`, `alarms.service.ts:143`,
  `:338`, `alarm-details.service.ts:123`). The socket scope is
  `assetIds.includes(alarm.assetId)` (`alarms.gateway.ts:135`). The lifecycle
  sweep loads `rule_id IS NOT NULL` only (`alarm-lifecycle.service.ts:414`).
  A dispatch needs `ruleId: string` (`notifications.service.ts:120`) and loads
  channels from the rule's join (`:215`). No non-rule system alarm exists.
- **The worker schedules a repeating job** with `upsertSchedule` per queue in
  `WorkerHostService.onModuleInit` (`worker-host.service.ts:152-175`), from the
  `ALL_QUEUES` list (`queue/queues.ts:41-49`), behind the import fence
  `tests/f4.24-worker-imports-no-api-loop.test.ts`.
- **A simulator RTU never passes through the ingest host**; `apps/sim` writes
  `telemetry.point_values` itself.

## Decision

1. **Scope (Q1).** This row ships visibility **and** a comms-loss alarm.
   Visibility is: the first dropped `(assetId, pointKey)` per drop counter per
   batch is named; per-RTU last-seen, drop counts and clock skew are
   persisted; the ingest host has a real heartbeat; the UI shows all of it.
2. **Transport (Q2).** The ingest host writes database tables, as it writes
   `edge_gateways.last_seen_at`. No `prom-client`, no `NOTIFY`-only path.
3. **History (Q3).** Per-RTU hourly buckets of the six drop counters, with the
   first dropped `(assetId, pointKey)` per counter, kept 30 days, then pruned.
4. **Screens (Q4).** The admin RTUs page gains Last seen, Online / Stale /
   Offline, clock skew and drop counts with the first dropped point. The
   footer's `field_data` component (`GET /api/v1/system/status`) uses the real
   heartbeat. An "N devices offline" KPI is added (decision 19).
5. **Alarm (Q5).** A built-in per-RTU "Communication lost" alarm is raised by
   the API worker when the RTU's last-seen passes its freshness window (the
   `telemetry-cadence.ts` window), and cleared when data returns. It uses the
   existing alarms table, acknowledgement and notification path. It is not a
   new rule type and the ingest host does not raise it.
6. **Host down (Q6).** While the ingest-host heartbeat is stale, an "Ingest
   host not reporting" alarm is raised and per-RTU comms-loss alarms are held.
7. **Four tables, one migration (`0149`).** Tenant tables `bms.rtu_health`
   (one row per RTU) and `bms.rtu_drop_hours` (one row per RTU, hour and
   reason, only when a count is above zero). Both carry `organization_id`,
   a composite key to `bms.rtus (id, organization_id)`, `tenant_isolation`
   under `FORCE`, and `SELECT` only for `bms_tenant` (the `0142` pattern).
   Platform tables `bms.ingest_hosts` (one row per host) and
   `bms.ingest_endpoint_drop_hours` (decision 17) hold host state and no
   tenant data, carry no `organization_id`, and are revoked from `bms_tenant`
   entirely. The writer derives `organization_id` in SQL from `bms.rtus`; it
   never supplies one. Plain tables, no hypertable. No new role: the host
   stays `bms_fleet`; the owed `bms_ingest` role would need `SELECT` on
   `bms.rtus` and write verbs on these four tables only.
8. **Attribution.** A drop belongs to an RTU when the sample's `deviceKey`
   resolves to a bound RTU. `badQuality`, `outOfRange` and a post-scale
   `nonFinite` name `(assetId, pointKey)`. `unmappedSourceKey` and a raw
   `nonFinite` name the source key, because no point exists yet.
   `unknownDevice` and `ambiguousDevice` have no RTU by definition and are
   counted per host and endpoint (decision 17). Device-supplied strings are
   cut to 128 characters, stripped of control characters and rendered as text.
9. **Last-seen and skew.** Last-seen is the newest receive time of any sample
   from the device that reached the normaliser, written or dropped. It only
   moves forward, so a disk-buffer replay cannot move it back. Clock skew is
   `device_time − receive time` of the newest sample that has a device time,
   in seconds, positive when the device is ahead.
10. **Heartbeat.** The host flushes every 10 s (decision 16) in one
    transaction: its `ingest_hosts` row (`started_at`, `healthy_since`,
    `last_beat_at`) and the RTU rows and buckets that changed. `healthy_since`
    restarts at boot and after a missed beat. The host stamps
    `monitored_since` when an RTU enters its plan and clears it when it leaves.
11. **One state rule, judged against the host's last beat.** For a monitored
    RTU with window `W`:
    `age = host.last_beat_at − greatest(last_seen_at, monitored_since,
    host.healthy_since)`. Online is `age ≤ 0.6 W`, Stale is `0.6 W < age ≤ W`,
    Offline is `age > W`. Because the reference is the host's beat and not the
    wall clock, a stopped host freezes every RTU's state, which is decision 6
    by construction; a restart, an outage or a newly enabled RTU each get one
    full window. An RTU the host does not serve is "Not monitored". One pure
    function in the API holds the rule, so the RTUs page, system status, the
    worker sweep and the lifecycle clear cannot disagree.
12. **Device alarms in `bms.alarms` (Q7).** Migration `0151` (renumbered from
    `0150`, see *Build notes*) makes `asset_id`
    nullable and adds `source` (`rule`, `rtu_comms`, `ingest_host`) and
    `rtu_id`, with a CHECK on the shape per source and a second partial unique
    index for the dedupe. `AlarmRaiser` gains `raiseDevice` and stays the one
    raiser. A worker queue `device-health` (every 30 s) raises and prunes. The
    lifecycle sweep clears device alarms from the decision-11 rule, with a
    hold, and stays the one writer of `cleared_at`. Readers that list alarms
    show device alarms; asset-keyed readers keep excluding them, except the
    open-alarm counts, which must agree with the list. The list contract's
    `assetId`, `assetCode`, `assetName` and `siteName` become nullable.
13. **Notification (Q8).** A device alarm is routed by the organization's
    escalation profile for its severity (ADR 0057 decision 6): each due step
    notifies its channels while the alarm is unacknowledged, the first step at
    1 minute or later. An organization with no profile sees the alarm in the
    alarm centre only. No new screen.
14. **Who sees what (Q9).** RTU health keeps the RTUs page's gate:
    `requireMasterDataUser`, inside the caller's writable locations. A device
    alarm is visible to users whose read scope holds at least one asset served
    by that RTU; the host alarm to users with any asset served by a monitored
    RTU of that organization. Acknowledging keeps today's gate
    (`assertOperationsWriteRole(user, "operational")`).
15. **The host alarm is one per organization (Q10, Q11).** "Ingest host not
    reporting" is raised once in each organization that has a monitored RTU,
    so each organization's operators see it in their own alarm centre.
    Severities: `warning` for "Communication lost", `critical` for "Ingest host
    not reporting".
16. **Numbers (Q12).** Heartbeat and flush every 10 s; the host is stale after
    30 s with no beat; Stale from 60 % of the window, Offline past it; the
    worker sweep every 30 s; a device alarm clears after 120 s back Online;
    clock skew is highlighted beyond ±300 s, with no alarm on skew. The flush
    and sweep intervals are environment settings with bounds.
17. **The two counters with no RTU (Q13).** `unknownDevice` and
    `ambiguousDevice` are persisted hourly per host and endpoint for 30 days in
    `bms.ingest_endpoint_drop_hours`, with the first device key and source key,
    and shown to the global admin only, because a device key can belong to any
    customer.
18. **Edge-served RTUs (Q14).** An RTU behind an edge gateway (ADR 0123) gets
    last-seen, state and drops, and raises **no** comms-loss alarm in this row,
    because store-and-forward makes its last-seen lag by design. A new backlog
    row owns an "Edge gateway not reporting" alarm and the hold it implies.
19. **The KPI (Q15).** "N devices offline" counts monitored RTUs in the
    caller's scope whose state is Offline. It shows as a tile on the main
    dashboard ribbon and in the RTUs page header, fed by a `devices`
    `{ monitored, offline }` block on `GET /api/v1/system/status`.
20. **Simulator and catalog RTUs (Q16).** They never reach the ingest host, so
    they read "Not monitored" and raise no alarm. The Eskom demo sites show no
    device health; `apps/sim` is not a second writer.
21. **`field_data`** is `degraded` when the host heartbeat is stale or absent,
    `ok` when it is fresh, and `not_monitored` when the caller has no MQTT
    asset. Silent devices no longer degrade it; they show in the offline count
    and in data quality. Only the state crosses into the body (ADR 0075
    decision 4).

## Owner rulings (2026-11-11)

Asked one at a time, with options; the recommended option is the one ruled
unless noted.

1. **Q1 Scope** — visibility and the comms-loss alarm in this row (not the
   recommended "alarm later"). Re-asked once the alarm's cost was known
   (≈10–12 days): **keep both in `F3.16`**.
2. **Q2 Transport** — the ingest host writes database tables.
3. **Q3 History** — per-RTU hourly buckets, 30 days.
4. **Q4 Screens** — RTUs page, footer status, KPI.
5. **Q5 Alarm** — built-in per-RTU alarm raised by the API worker.
6. **Q6 Host down** — one host alarm; per-RTU alarms held.
7. **Q7 Alarm key** — nullable `asset_id` plus `source` and `rtu_id`.
8. **Q8 Notify** — the organization's escalation profile.
9. **Q9 Visibility** — existing gates; the asset rule for device alarms.
10. **Q10 Host alarm** — one per affected organization.
11. **Q11 Severity** — comms `warning`, host `critical`.
12. **Q12 Numbers** — the decision-16 set.
13. **Q13 No-RTU drops** — per endpoint, global admin only.
14. **Q14 Edge RTUs** — visibility only; a follow-up row for the gateway alarm.
15. **Q15 KPI** — RTUs, dashboard ribbon and RTUs page header.
16. **Q16 Simulator RTUs** — "Not monitored", no alarm.
17. **Dependency** — `F1.x` is met by `F1.1`, `F1.7` and `F1.10`; later
    adapters inherit the seam.

## Consequences

- An operator can tell which point stopped and why, per RTU, for 30 days. The
  `eng_min` silencing noted on the backlog row becomes visible as
  `outOfRange` with its point named.
- A dead RTU raises one alarm; a dead host raises one alarm per organization
  and no flood.
- `bms.alarms` stops being asset-only. Every reader of `alarms.asset_id` is
  re-read once; `tsc` finds them when the column type becomes nullable.
- The host writes every 10 s: one row for itself and one per RTU that spoke.
- State compares the ingest host's last beat, stamped on the **database**
  clock since PR A's code review (see *Build notes*), with RTU last-seen and
  `monitored_since`, stamped on the ingest host's clock. The two clocks must
  agree to well under the 25 s window floor (NTP), the assumption every
  freshness window already makes; host staleness compares the beat with the
  database clock.
- Machine writes carry no audit row, like `edge_gateways.last_seen_at`. No
  user write route is added.
- Limits kept: no alarm on clock skew, on drop rate, for an edge gateway
  (decision 18), or for an endpoint (broker) outage, which raises one alarm per
  RTU.
- Owed after merge, as a separate `chore(agents):` sweep: AGENTS.md §4.4's
  platform-table list and its ingest description; a dated note on ADR 0075.
- A new backlog row: the "Edge gateway not reporting" alarm (decision 18).

## Build notes (PR A, 2026-11-11)

Facts the build settled; none changes a ruling.

- **Migration `0150_device_health_utc_bucket`.** `0149`'s whole-hour CHECK
  used `date_trunc('hour', bucket)`, which follows the session time zone and
  refused every bucket in a half-hour zone (`Asia/Kolkata`). Committed
  migrations are never edited, so `0150` replaces both checks with the UTC
  form. Decision 12's alarm migration is therefore `0151`.
- **Clocks (decision 10).** The host row's `started_at`, `healthy_since` and
  `last_beat_at` are the database's `now()`; RTU `last_seen_at` and
  `monitored_since` stay on the ingest host's clock (Consequences).
- **A missed beat (decision 10)** is a gap above `INGEST_HOST_STALE_SECONDS`
  (30 s) since the last committed beat — the bound at which the API freezes
  states — not two flush intervals, so one failed flush cannot make an Offline
  RTU read Online.
- **Edge-served (decision 18)** is derived from `rtus.edge_gateway_id IS NOT
  NULL`; the ingest host does not store it.
- **Foreign keys.** The tenant tables' composite keys to `bms.rtus` are
  `ON DELETE CASCADE` (derived rows never block an RTU delete) and
  `ON UPDATE NO ACTION`, so an RTU cannot move organization while it has
  health rows; no route moves one today.
- **Reason CHECKs** accept all six reasons on both bucket tables, wider than
  decisions 8 and 17 use; deliberate, so a later attribution change needs no
  migration.
- **A first dropped asset** is labelled only while it is still on the bucket's
  RTU, and device-supplied strings also lose Unicode format characters
  (security review).

## Build notes (PR B, 2026-11-11)

- **Migration `0151_device_alarms`** (decision 12). Drizzle applies every
  pending migration in **one** transaction, so the `ACCESS EXCLUSIVE` lock that
  `DROP NOT NULL` and `ADD COLUMN` take on `bms.alarms` is held until the whole
  run commits, across the two `VALIDATE` scans, the foreign key's check and the
  partial index build. The `NOT VALID`/`VALIDATE` split in the file buys no
  concurrency under this migrator, and the file's header comment says
  otherwise (committed migrations are not edited, so the correction lives
  here). `bms.alarms` is a plain table; at real volumes the stall is seconds.
  Run `db:migrate` on a pilot in a quiet window, with the worker stopped.
- **`alarms.rtu_id` is `ON DELETE NO ACTION`**, unlike the health tables'
  cascade: an alarm is history. An RTU with a device alarm cannot be deleted
  (no route deletes one); there is no index on `alarms.rtu_id`, so an RTU
  delete's check scans `bms.alarms`.
- **One scope rule** (decision 14) in `apps/api/src/alarms/alarm-scope.ts`,
  rendered for Drizzle, raw SQL and the socket's in-memory check; list,
  summary, acknowledge, details, the socket, the dashboard ribbon and its prior,
  and the organization control room's open/critical tiles all use it, so every
  open-alarm count agrees with the list. Asset-keyed readers (map, stats,
  location summary, work orders, site widgets, role summary) keep excluding
  device alarms by their inner join.
- **The socket's device scope is cached at the handshake**, like its asset
  ids; a re-wired asset or a newly monitored RTU reaches an open socket on
  reconnect. A host alarm's organization is read per event, and a failed read
  fails closed.
- **Clear (decision 16).** ADR 0057's `normal_since` and `decideClear` with a
  120 s hold. An RTU alarm is "normal" only when the RTU is Online **and** has
  been heard since the alarm was raised, so a host restart (one fresh window
  for every RTU) cannot clear a still-silent RTU. A stale host resets the hold.
  Leaving monitoring, becoming edge-served or deletion clears at once. A host
  alarm clears after 120 s fresh, or at once when no monitored RTU is left.
- **Notification (decision 13).** `DispatchInput.ruleId` is nullable; the
  delivery dedupe key uses the token `system` in the rule's place; a cleared
  message goes only to channels that already received the alarm.
- **Out of the device-alarm path:** enrichment (the API refuses it for every
  caller), work orders (need an asset), and the copilot (it lists rule alarms
  only and refuses device-alarm details). Acknowledging follows the scope rule,
  so a user with one asset on a monitored RTU can acknowledge the
  organization's host alarm and stop its escalation — decision 14 as ruled.
- **`DEVICE_HEALTH_INTERVAL_MS`** sets the worker sweep (default 30000, bounds
  10000–3600000; outside them the worker refuses to start).

## Dependencies

None added. Uses BullMQ (ADR 0063) and the pools of ADR 0045.
