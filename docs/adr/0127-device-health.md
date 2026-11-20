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

**Amendment 2 (`F3.89`, accepted 2026-11-20)** makes the host alarm name the
host, sites and RTUs, and holds its raise 120 s so a deploy restart raises none.

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

## Amendment 1 — a five-minute raise delay for "Communication lost" (2026-11-12)

**Accepted by the owner, 2026-11-12** (in chat, after the AWS check found the
flapping: "Fix the flapping first", and the raise delay ruled at **5 minutes**,
the recommended option).

**Why.** Decision 5 raised "Communication lost" as soon as last-seen passed the
freshness window. The BCPL RTUs report every 10 s (median over 24 h), so their
window sits at its 25 s floor (`clamp(ceil(2.5 × 10), 25, 900)`), while their
p99 gap is 20–120 s. A normal 30–60 s pause therefore read Offline, the 30 s
sweep raised the alarm, and the 120 s hold cleared it: on 2026-11-12 LEPPLT1
raised four alarms in an hour, DULPLT3 three and BARTS2 two, each open for 2–10
minutes and each a notification through the escalation profile.

**Decision.** Decision 5 is amended: a per-RTU "Communication lost" alarm is
raised when the RTU is Offline (decision 11, unchanged) **and** has been silent
at least `RTU_COMMS_RAISE_AFTER_SECONDS` = **300 s**, counted the same way as
the state (`rtuSilentSecondsAt`: from the latest of last-seen,
`monitored_since` and the host's `healthy_since`). Decision 16 gains that
number. Everything else stands:

- The Online / Stale / Offline display, the offline count and `field_data` keep
  the window; only the alarm waits.
- A window longer than 300 s (up to the 900 s cap) still governs: the alarm
  needs Offline first.
- The 120 s clear hold, the host-down hold-back (decision 6) and the
  per-organization host alarm are unchanged.

**Cost.** A real outage now alarms 5 minutes after the last reading, not after
the window: in practice 300 s, plus up to 10 s for the host's beat, plus up to
30 s for the sweep. The 300 s also count again from each host restart or
missed beat (`healthy_since`, decision 10), so for 5 minutes after one no RTU
raises "Communication lost"; decision 11's "one full window after a restart"
now holds for the display only. A host whose beat gaps past 30 s more often
than every 5 minutes would therefore hold every comms alarm — rare, since it
takes three failed flushes, and the host alarm covers a gap it catches. Tests: `device-health-sweep.service.spec.ts` (299 s raises
nothing, 300 s raises one; a 900 s window still governs).

## Amendment 2 — the host alarm names the host, sites and RTUs, and a deploy restart raises none (`F3.89`, proposed 2026-11-20)

**Accepted — 2026-11-20** (owner, in chat on PR #1468: "Approved and merge"). The
PR listed the six questions below with a recommended answer each; the approval is read
as the recommended answer on all six (Q1 a, Q2 a, Q3 a, Q4 a, Q5 a, Q6 a = 120 s), and
the plan is approved with it. Raised by the owner in chat: add which
site, which locations and which active RTUs stopped reporting to the alert
message; then, the same day (relayed from the owner's chat by another
session): "Add the deploy restart grace to that session too". The open choices
are under *Questions for the owner*, each with a
recommended answer. Plan:
[`docs/plans/f3.89-ingest-host-alarm-detail.md`](../plans/f3.89-ingest-host-alarm-detail.md).

**Why.** Decisions 6 and 15 fix the text "Ingest host not reporting" for every
organization. An operator who gets it cannot tell which host stopped or what it
affects. On AWS (read-only check, 2026-11-20) one ingest host row,
`host_key = cloud`, serves all three organizations (PHEWB, BCPL, WBLDC). Each
organization got 162 `ingest_host` alarms in 8 days (~20 a day), always all
three in the same second, each clearing after ~2–2.5 min.

**Most of them are deploy restarts.** Each of those alarms matches an ingest
restart: the host's `started_at` lands a few seconds after the alarm's
`raised_at` (for example raised 03:02:37, host started 03:02:45 UTC). So most
are deploy restarts: the host beats every 10 s, is stale after 30 s
(`INGEST_HOST_STALE_SECONDS`) and the sweep runs every 30 s
(`DEVICE_HEALTH_INTERVAL_MS`), so a restart that takes 30–60 s raises a
critical alarm in every organization, which clears ~2 min later. Goal: a
normal deploy restart raises no `ingest_host` alarm; a real outage still raises
one.

**Decision, part A — the text.** Decisions 6 and 15 are amended: the `ingest_host`
alarm's message is built per organization when it is raised (names
illustrative):

```
Ingest host not reporting: cloud — 14 RTUs at 9 sites stopped: Lotapata I, Lotapata II, Bilsi I, Mora Nodir Kuthi I, Bhutnirghat I, +4 more sites; RTUs: LOTPT1, LOTPT2, BILSI1, MNK1, BHUT1, +9 more
```

1. **Host.** The `host_key` of each serving host that is not reporting
   (stale, or named by an RTU with no host row), sorted, comma-separated.
2. **RTUs.** The organization's monitored RTUs (`monitored_since` set) served
   by those hosts whose decision-11 state at the host's last beat was Online
   or Stale, so they were reporting until the host stopped. An RTU already
   Offline is left out: it stopped on its own and has its own "Communication
   lost" alarm. Edge-served RTUs count, because their uplinks pass through
   the host too (Q2). Name: display name, else code, as `rtuCommsMessage`.
3. **Sites.** The distinct `bms.locations.name` of those RTUs'
   `location_id` (since ADR 0139, one site per PHE RTU).
4. **Caps.** At most 5 site names and 5 RTU names, sorted by name, then
   `+N more`. Each name is cut to 64 characters, and the whole message to 500
   characters with `…`. With no RTU in the list (all already Offline) the text
   is `Ingest host not reporting: cloud — no active RTUs`.
5. **Only the organization's own.** The list is built from that
   organization's rows only (the sweep already groups by organization), so no
   message names another organization's site or RTU.
6. **Fixed while open.** `raiseDevice` inserts with `ON CONFLICT DO NOTHING`,
   so the message is the snapshot at raise time. Later ticks do not rewrite it,
   do not re-raise and do not send new notifications. The notification dedupe
   key is the alarm, not the text (ADR 0041 decision 7), so nothing churns.
   The clear text stays `Cleared: <message>`.
7. **Logging (§9.6).** The sweep keeps logging ids and the cause, never the
   alarm text.
8. **No schema change.** No new column; the alarm row stays
   `source = 'ingest_host'` with no RTU and no location, so the Site column
   stays blank and the subject stays "Ingest host" (Q4).

**Decision, part B — a raise hold for the host alarm (Q5).**
Decision 16 gains `INGEST_HOST_RAISE_AFTER_SECONDS` = **120 s**: the
`ingest_host` alarm is raised only when a serving host has been silent at
least that long, counted on the database clock from its `last_beat_at`
(`dbNow − lastBeatMs`, as `hostSummaryFor` returns it). The host still reads
stale after 30 s for everything else (footer `field_data`, RTU states frozen).
A host key with no host row (`never`) has no beat to count from and raises at
once, as today.

- **Why 120 s.** On AWS the restart gap is ~40–70 s (stale at 30 s, raised at
  the next sweep, the new host up ~8 s later). 120 s covers it with margin; a
  deploy that pulls a slow image may still pass it, and then it is worth an
  alarm.
- **Cost.** A real outage now alarms after ~120–150 s (hold plus one sweep),
  not ~30–60 s. Every option delays a real alarm; this one by a fixed, known
  amount.
- **Per-RTU alarms during the hold.** Unchanged and still held: while the host
  is stale the sweep raises no `rtu_comms` alarm, whether or not the host alarm
  is raised yet (decision 6). After the restart, `healthy_since` resets, so
  Amendment 1's 300 s counts again from it and no RTU raises "Communication
  lost" for 5 minutes. So a deploy raises nothing at all.
- **Clear path unchanged.** The lifecycle sweep still clears an open host alarm
  after 120 s of a fresh host (decision 16). A gap shorter than the hold opens
  no alarm, so there is nothing to clear.
- **Options not chosen.** (b) A restart grace keyed on a fresh `started_at` or
  `healthy_since` cannot help on its own: while the host is down its row still
  holds the *old* `started_at`, so the sweep only learns of a restart after the
  host is back — too late to hold the raise. It works only with a deploy marker
  written by `bms-ctl` before the stop (a new write, and a marker left behind
  hides a real outage unless it expires). (c) Both: more code for the same
  result on today's evidence.

Everything else in decisions 6, 14, 15, 16 and Amendment 1 stands: one
critical host alarm per organization, the per-RTU alarms held while the host
is stale, the 120 s clear hold and who can see and acknowledge it.

**Security.** Decision 14 shows the host alarm to any user of the organization
with an asset served by one of its monitored RTUs, including a location-scoped
user. With this amendment that user reads the names of sibling sites and RTUs
of their own organization. Names only, no readings and no ids, and never
another organization's. This is the same class as `F4.396` (dashboards list).
No PHEWB location grant exists today (ADR 0139 *Context*), so no one is
affected yet. Q3 asks whether to accept this or to show only counts.

### Questions for the owner (ruled 2026-11-20: the recommended answer on each)

1. **Q1 Message shape.** (a) Host key, counts, up to 5 site names and up to
   5 RTU names, then "+N more" (the example above) — **recommended**; (b) host
   and counts only; (c) every name, no cap.
2. **Q2 Which RTUs.** (a) Monitored RTUs of the stale host that were Online or
   Stale at its last beat, edge-served included — **recommended**; (b) every
   monitored RTU of the host, Offline included; (c) cloud-served only.
3. **Q3 Scoped users.** (a) Accept: every reader of the host alarm sees the
   organization's names, revisit with `F4.396` before per-office logins —
   **recommended**; (b) names only for organization-level users, counts for
   scoped users (needs a read-time view and is a larger build).
4. **Q4 Site column.** (a) No schema change; the names live in the message —
   **recommended**; (b) a migration adding `host_key` (and a label) to the
   alarm row so the grid's subject reads "Ingest host cloud".
5. **Q5 Deploy restarts.** (a) A raise hold: alarm only after 120 s of
   silence — **recommended** (delays a real alarm by ~90 s; no new write);
   (b) a restart grace on a deploy marker written by `bms-ctl` (a real outage
   during a deploy is hidden until the marker expires; more build); (c) both.
6. **Q6 The hold's length** (if Q5 is a or c). (a) 120 s — **recommended**;
   (b) 180 s (more margin for slow deploys, a later real alarm); (c) 300 s, the
   same as Amendment 1.

## Dependencies

None added. Uses BullMQ (ADR 0063) and the pools of ADR 0045.

## Owner rulings after closure (2026-11-12)

Asked in chat one at a time; both ruled as recommended.

- **The host-alarm acknowledge stays as decision 14 ruled.** Any user who sees
  an organization's "Ingest host not reporting" alarm and holds the
  operational write role can acknowledge it and stop its escalation for
  everyone. The acknowledge is audited with the user, so it is attributable. No
  code change.
- **`F3.88`'s gateway stale threshold is 5 minutes**, the same as
  Amendment 1's raise delay: "Edge gateway not reporting" is raised when
  `edge_gateways.last_seen_at` is more than 300 s old. The row still needs its
  own plan and migration.
