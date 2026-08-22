# The ingest host

Operator notes for `apps/ingest`, whose one entry point is the pluggable adapter
host from `F1.1` (**[ADR 0016](./adr/0016-ingest-adapter-framework.md)**).

## One entry point, as of §6 commit 4

| Command | What it is |
| --- | --- |
| `pnpm start` → `node dist/main.js` | The pluggable adapter host, and what the pilot runs. Serves MQTT today; `F1.2`–`F1.6` add protocols. |

**The strangler migration is finished.** ADR 0016 §6 ran it in four commits:
commit 2 built the host beside the ADR 0007 pilot's `src/index.js`, commit 3
verified the two produced an identical point set and cut the deployment over on
**2026-08-06**, and **commit 4 (2026-08-14) deleted `src/index.js`**, pointed
`"start"` at `dist/main.js`, removed the compose `command:` override and deleted
the `INGEST_NOTIFY` flag.

Two consequences worth knowing before an incident, not during one:

- **There is no longer a legacy path one line away.** Reverting the cutover used
  to be deleting a compose line; it is now reverting a commit. What that line
  bought — a fallback that needed no rebuild — is gone deliberately, because a
  permanent second entry point is the realistic failure mode of a strangler
  (ADR 0016 Resolved decision 4).
- **`pnpm start` needs a build first.** The host is TypeScript and there is no
  JavaScript entry point behind it any more, so an unbuilt tree does not fall
  back — it fails to start:

```bash
pnpm --filter ingest build
```

The image builds it (`apps/ingest/Dockerfile` runs `pnpm --filter ingest build`
before `CMD ["pnpm", "start"]`), so this only bites a local run.

One thing commit 4 did **not** do: retire the `MQTT_USERNAME` / `MQTT_PASSWORD`
fallback. `bms.rtu_connection_configs` is still empty (re-measured 2026-08-14),
so that fallback is the pilot's only working credential path. It moved to
`E8.4` — see [ADR 0016 Amendment 3](./adr/0016-ingest-adapter-framework.md).

## Environment

Adapters never read `process.env` at all (ADR 0016 §4). The **host** reads it in
`src/host/config.ts` — and in one other place, which the table below makes
explicit: the pilot-era `MQTT_*` credential fallback inside the unmodified
`src/rtu-config.js`, reached through `resolveMqttConnection`. That fallback is
still the only working credential path (ADR 0016 Amendment 3).

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | — | Required. |
| `INGEST_HOST_HEALTH_PORT` | `9103` | **Compose sets it to `9102`**, which is the port it publishes. The default is 9103 rather than 9102 for a historical reason: the ADR 0007 entry point bound 9102 as `INGEST_METRICS_PORT` and §6 commit 3 needed both processes up at once. That entry point is gone, but the separate default is kept so two hosts side by side still need only one variable set. |
| `INGEST_RELOAD_MS` | `60000` | How often point mappings are refreshed. Matches what the ADR 0007 pilot did. |
| `INGEST_STALE_AFTER_MS` | `300000` | Silence longer than this marks one RTU `stale` on the health endpoint (`F1.7`). Five minutes because the fleet was measured, not guessed: the nine live PHE RTUs publish every ~60 s (probe, 2026-08-22, 600 s window), so this is five missed cycles — a single dropped message can never raise it. Widen it for a protocol that polls far more slowly than MQTT pushes. |
| `MQTT_HOST` / `MQTT_PORT` / `MQTT_USERNAME` / `MQTT_PASSWORD` | pilot-era | MQTT **only**, resolved by the host through the unmodified `src/rtu-config.js`. No new adapter gets an environment fallback. |
| `MQTT_TLS_REJECT_UNAUTHORIZED` | on | Only the exact string `false` disables TLS verification, as in the ADR 0007 pilot. |
| `CREDENTIAL_ENCRYPTION_KEY` | — | ADR 0012. Without it, encrypted per-RTU credentials are simply not read. |

**Deleted at §6 commit 4, and not merely defaulted:** `INGEST_NOTIFY`,
`INGEST_METRICS_PORT` and `MQTT_RECONNECT_MS`. The last two were read only by the
deleted entry point — the host owns its own reconnect (exponential, jittered) and
binds `INGEST_HOST_HEALTH_PORT`. A copy left in an old `.env` is inert; the specs
assert that rather than leaving it to be discovered.

### Realtime is unconditional, and that is the point of commit 4

The host always emits `pg_notify('bms_telemetry', …)`. There is no flag, no
option and no default that can turn it off.

It was not always so, and the history is worth keeping because the reasoning
inverted. During the parallel-run window two processes wrote the same rows
through `ON CONFLICT (time, asset_id, point_key) DO UPDATE`, so concurrent
*writes* were idempotent. Concurrent `pg_notify` is not:
`telemetry-notify.service.ts` holds a `LISTEN bms_telemetry` and fans every
payload to Socket.IO, so two notifying processes would have delivered **every PHE
reading to the live dashboards twice**. `INGEST_NOTIFY` defaulted to off for
exactly that window.

**At the cutover that safety argument inverted.** With one ingest process nothing
could double, and the flag became the only way to reach a state where rows keep
landing while every dashboard goes dead — no error, no alarm, the sole signal
being `notify=off` in the health body. For eight days it was compose's
`INGEST_NOTIFY: "on"` line alone that kept realtime alive.

Commit 4 deleted the flag rather than defaulting it to on, so that state is
unreachable **by ingest configuration** rather than merely unlikely. Two limits
on that, both worth knowing before an incident:

- **`notify=on` in the health body is now a literal and tells you nothing about
  delivery.** It reports intent, and it prints `on` whether or not a single
  notification has succeeded. **Watch `written=` and `lastSample=` on the
  endpoint line instead** — since commit 4 there is no branch between writing and
  notifying, so `writeResolved` either does both or throws, and a failing
  `pg_notify` lands in `writeFailures=` rather than passing silently. A rising
  `written=` is therefore evidence that notifications are flowing; `notify=on` is
  not.
- **The same silent outage is still reachable one hop downstream.** The API's
  `telemetry-notify.service.ts` holds the `LISTEN bms_telemetry` with no error
  handler and no reconnect, so a dropped listener connection gives dead
  dashboards with healthy ingest — `notify=on`, `written=` climbing, nothing in
  the logs. That is pre-existing and outside this host; it has its own backlog
  row. If dashboards are dead and ingest looks healthy, suspect the listener.

## Health endpoint

Plain text, on `INGEST_HOST_HEALTH_PORT`. No metrics library — `prom-client`
is deferred to `F1.10` / `F3.16` (ADR 0016 §Dependencies).

```
ingest-host degraded endpoints=1 rtus=3 stale=1 skipped=0 notify=on uptime=39s
endpoint protocol=mqtt key=phe.thinkiot.co.in:8883 state=connected rtus=861736076104923|861736076128245|861736076133666 restarts=1 pollFailures=0 queue=0 dropped=0 written=812 writeFailures=0 lastSample=2026-08-22T09:41:07.000Z
stale rtu=861736076133666 endpoint=phe.thinkiot.co.in:8883 lastSample=never
```

- One `endpoint` line per supervised connection. `rtus=` enumerates the devices
  that genuinely share it and would fail together — the blast radius.
- **One `stale` line per RTU that has stopped publishing** (`F1.7`). An
  endpoint's own `lastSample=` is the *connection's* liveness, and MQTT groups
  every RTU on a broker into one connection, so one talkative station kept that
  timestamp fresh for a fleet that had gone quiet. `stale=` counts them
  host-wide and degrades the host, while the endpoint stays `connected` — the
  broker is fine, the station is not, and restarting the connection would not
  fix it. `silentFor=` is omitted for an RTU that has never published at all:
  that is a mapping error rather than a silence.
- `skipped` lines name every RTU left out and why (`no-adapter`,
  `unsupported-protocol`, `missing-rtu-code`, `invalid-connection-config`, …),
  so a gateway that never appears is visible without reading the log.
- `dropped` and `writeFailures` are the loss counters. They are the signal that
  a database outage is costing telemetry; durable buffering across one is
  `F1.10`, not this.

Logs are JSON lines on stdout. Credential values never appear in them — the
adapter conformance suite asserts it with a seeded sentinel.

## The ADR 0016 §6 commit 3 parallel verification (historical)

**This section records what was done on 2026-08-06. It is no longer runnable**
— commit 4 deleted the legacy process, so there is nothing left to compare against,
along with both commands the procedure used (`pnpm start:host` and
`INGEST_NOTIFY=off`). It is kept because the *result* below is the evidence the
cutover rested on, and evidence with no method is not checkable.

The point of the exercise was to prove the host wrote what the legacy process
wrote, before anything was cut over. As run:

1. Leave the legacy process running as the compose `ingest` service.
2. Build, then start the host **against the same database**, with notify off and
   its own health port (`INGEST_HOST_HEALTH_PORT` unset, taking the 9103
   default) so the two could not collide:
   `cd apps/ingest && DATABASE_URL="$DATABASE_URL" INGEST_NOTIFY=off pnpm start:host`
3. Over the window, compare row counts, timestamps and per-RTU sample rates in
   `telemetry.point_values`. Both processes upsert the same primary key, so
   agreement means the host resolved the same points from the same payloads.
   Exactly one difference was expected: `network_strength` — see *Deliberate
   divergences* below.
4. Then set `INGEST_NOTIFY=on` **and** flip the compose `ingest` service to
   `command: ["pnpm", "start:host"]` in the same step, stopping the legacy
   process.

**If a comparison of this kind is ever needed again** — for `F1.2`–`F1.6`, where
a new adapter's output wants checking against a known-good one — it cannot be
this procedure. There is one entry point now, so the two sides have to be two
*endpoints* under one host, or one host against a recorded fixture, and neither
is built. That is a real gap and it belongs to whichever item first needs it.

### Result of the 2026-08-06 run

Run against the live Bhutnirghat I feed the day the pilot was first brought up,
on the build immediately before the `network_strength` fix — so it is a
like-for-like comparison. The RTU publishes once a minute, which makes the
windows clean. **Step 4 was taken later the same day**, on the fixed build;
see *Result of the cutover* below.

| Window | Messages | Rows | Points/msg |
|---|---|---|---|
| legacy alone | 5 | 100 | 20 |
| both in parallel | 1 | 20 | 20 |
| host alone | 2 | 40 | 20 |

- **Point-set differential empty in both directions** — `EXCEPT` on
  `(asset, point_key, unit)` between the legacy-only and host-only windows.
- **Concurrent writes do not duplicate.** The parallel minute holds 20 rows,
  not 40; the `ON CONFLICT` upsert holds.
- **`kwh_total` continuous across the handover** (47955 → 47956, monotonic).
- **`INGEST_NOTIFY` verified as behaviour, not configuration.** Positive control
  with legacy running: 2 payloads in 95 s. Host with `off`: **zero
  notifications while writing 60 samples.** Same host with `on`: 3 payloads,
  shape identical to legacy's `{"readings":[{time,assetId,pointKey,value,unit}…]}`.

Two caveats worth carrying: the window boundaries were derived from the
measured device-clock skew rather than from per-row process attribution, and
the parallel window is **one message wide**. The uniformity across all three
windows makes the conclusion robust, but that single row is the only direct
evidence of concurrent non-corruption.

### Result of the cutover

Taken the same day, once `network_strength` was fixed and merged. The compose
service was rebuilt and recreated onto `pnpm start:host` with `INGEST_NOTIFY:
"on"`.

- **Points per message went 20 → 21** at exactly the changeover minute, and
  `network_strength` began arriving. That is now every catalogued point.
- **Realtime survived**: 2 `bms_telemetry` notifications in a 140 s window,
  matching the device's one-per-minute cadence.
- **Health moved to the host's endpoint on the same published port** — 9102
  serves the host's body rather than the legacy one-liner, because
  `INGEST_HOST_HEALTH_PORT` is set alongside `INGEST_METRICS_PORT`. Status code
  and content-type are unchanged (200, `text/plain`), so a liveness probe keeps
  working — but the **body changed shape**: the prefix goes from `ingest ok …`
  to `ingest-host ok` / `ingest-host degraded`, and the body is one line plus
  one per endpoint and per skipped binding, not a fixed count. A check matching
  on the old substring breaks. Nothing in `infra/observability/` scrapes this
  port today.
- **`INGEST_NOTIFY: "on"` became required configuration** — with one ingest
  process there was nothing to double, so the flag stopped protecting anything
  and became the only thing keeping realtime alive. It held that role for eight
  days. **Commit 4 deleted it on 2026-08-14**, which is why realtime is now
  unconditional rather than one compose line deep.
- **One message was lost to the container restart**, the minute between the
  legacy process's last write and the host's first. Recreating the container is
  not a hot swap; a cutover run during a maintenance window would cost the same
  minute. The gap is a genuine hole in the series, not a display artefact.

## Deliberate divergences from the ADR 0007 pilot parser

While `src/index.js` ran the pilot it was frozen under ADR 0016 §6, so a defect
found in the shared parse logic could only be fixed on the host side. Two
behaviours therefore differ **on purpose**. Both are in
`apps/ingest/src/adapters/mqtt.ts`; neither is a porting error.

**Commit 4 deleted `index.js`, and this table stays** — it is not a comparison
with a file you can still read, it is the record of what the host does
differently from the behaviour the pilot had in the field for a year. The
`network_strength` row in particular explains a step change in the data on
2026-08-06 that is otherwise unexplained. Read the right-hand column as history.

| Divergence | Host | ADR 0007 pilot (`index.js`, deleted) |
|---|---|---|
| Readings published beside the `values` block | Merged in, nested wins a collision | Unreachable — `body.values` replaces the body |
| `dev_id` / `ts` as mappable readings | Never; envelope only | Readable, but only on a payload with no `values` block |
| A missing `ts` | Leaves `at` unset; the host substitutes receive time | Fabricates `Date.now()` |

The first is a **fix**, not a preference. The pilot RTU publishes `rssi` at the
top level, so `network_strength` — mapped in the PHE seed and documented in
`exports/PHE-MQTT-REFERENCE.md` — silently never arrived under `index.js`. It
was found on 2026-08-06 when the pilot was brought up for the first time: 20 of
the RTU's 22 catalogued points landed. The host on a post-2026-08-06 build
writes 21 samples per message where `index.js` writes 20 — and the RTU now
catalogues 21, so that is **every** mapped point, not 21 of 22. The 22nd was
`device_timestamp`; see below.

**The catalog diverges from the vendor export, on purpose.**
`packages/db/src/phe-catalog.json` is the TeleCash snapshot and still lists a
`TS` sensor per solar-edge controller — 12 rows, `DataKey = 'ts'`, mapped to
`device_timestamp`. That is the envelope's own timestamp, which the host
consumes as the sample time and can never deliver as a reading, so cataloguing
it as `source_kind = 'measured'` asserts a provenance false by construction.
`phe-pilot-seed.ts` skips those rows and migration `0025` deletes any an earlier
seed created; `verify-hierarchy-seed.ts` expects 252 PHE points, not 264. A
future vendor re-export that still carries `TS` will not resurrect them.

This was the standing argument for completing the cutover, and it is why the
cutover was taken on 2026-08-06 rather than left pending: while the legacy
process served the pilot it lost `network_strength` every minute. Since commit 4
there is no process that can — `pnpm start` is the host.

## Known limits in this build

Several entries below say a limit is *unchanged from* `index.js`. That file was
deleted at §6 commit 4; the comparison is kept because it says which limits the
host **inherited** from the ADR 0007 pilot rather than introduced, which is what
decides whether a fix belongs to `F1.7`/`F1.10` or to this host.

- **Reload refreshes point mappings only.** Mapping a new point onto an
  already-served RTU takes effect within `INGEST_RELOAD_MS`. Enabling a *new*
  RTU, or changing one's protocol or endpoint, needs a restart — the host logs
  `new endpoint requires a restart to serve` when it sees one. Reconciling the
  endpoint set is a second state machine on top of the supervisor's, and half
  of one is worse than none.
- **A device's clock is trusted without check.** Where the payload carries a
  timestamp it becomes the row's `time`, so telemetry inherits whatever the
  device believes. Measured on the pilot RTU on 2026-08-06: **~34 minutes
  ahead** of the server (Postgres and both containers agreeing). Not a timezone
  error — IST would be +5:30 — and unchanged from `index.js`, which uses `ts`
  the same way. It means live PHE rows land in the *future* relative to
  `now()`, which affects any dashboard window query and any rule evaluated on a
  recency bound. Nothing here detects or corrects it; deciding between trusting
  the device, stamping on receipt, or recording both is product work, not a
  host fix.
- **RTUs sharing an endpoint share credentials.** The first non-empty set wins.
  This narrows the `activeMqttConnection` singleton in `index.js` but does not
  cure it; `F1.7` owns the per-RTU credential story (ADR 0016 §Consequences).
- **A batch lost to a failed write is gone**, counted in `writeFailures`. The
  in-memory queue is bounded at 10 000 samples and drops oldest. `F1.10` gates
  any poll adapter at a customer site behind disk buffering for this reason.
- **`bms.rtus.mqtt_topic` is still a column.** The host shims it into the device
  slice for MQTT only, and a written `config.device.topic` wins. Backfilling it
  and retiring the column is owed follow-up.
- **Telemetry authenticity rests entirely on broker ACLs.** A message is
  attributed to an RTU by matching the payload's own `dev_id` against
  `rtus.rtu_code`, so any principal able to publish on a subscribed topic can
  attribute fabricated readings to another RTU's assets. This is unchanged from
  `index.js`, which routes the same way — but endpoint grouping by `host:port`
  means one broker connection now serves the *union* of RTUs on it, so the
  spoofable set widens as soon as `F1.7` adds RTUs. **`F1.7` should carry
  per-RTU broker credentials and topic-scoped ACLs in its scope**; it is not
  fixable inside the adapter, which cannot tell a genuine `dev_id` from a
  claimed one.

`rejectUnauthorized` is deliberately **not** settable from
`rtu_connection_configs.config` — an RTU whose stored config carries the key is
refused with `tls-downgrade-refused` rather than served. The environment
variable is the only way to lower TLS verification, matching `index.js`.
