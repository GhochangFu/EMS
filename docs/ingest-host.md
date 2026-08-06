# The ingest host

Operator notes for `apps/ingest`'s second entry point, added by `F1.1`
(**[ADR 0016](./adr/0016-ingest-adapter-framework.md)**).

## Why there are two entry points

`apps/ingest` currently ships two programs:

| | Command | What it is |
| --- | --- | --- |
| Legacy | `pnpm start` → `node src/index.js` | The original PHE MQTT pilot (ADR 0007). **Frozen** — not one line edited by `F1.1`. No longer serves the pilot. |
| Host | `pnpm start:host` → `node dist/main.js` | The pluggable adapter host, and **what the pilot runs** since 2026-08-06. Serves MQTT today; `F1.2`–`F1.6` add protocols. |

This is the strangler migration in ADR 0016 §6, and the two coexist
deliberately. **§6 commit 3 step 4 was taken on 2026-08-06**: the compose
`ingest` service carries `command: ["pnpm", "start:host"]` and `INGEST_NOTIFY:
"on"`. `pnpm start` is still the legacy process and still unedited, so reverting
the cutover is deleting that one compose line — no image rebuild, no code edit.

What remains is **§6 commit 4**: deleting `src/index.js`, pointing `"start"` at
`dist/main.js`, removing the compose override and retiring `INGEST_NOTIFY`. It
**needs a named owner** (ADR 0016 Resolved decision 4). Until someone owns it
the two-entry-point window stays open, and that duplication becoming permanent
is the realistic failure mode of a strangler — now more so, because the operational
pressure that would have forced the issue is gone.

The host must be built before it can run — it is TypeScript:

```bash
pnpm --filter ingest build
```

## Environment

Adapters never read `process.env` at all (ADR 0016 §4). The **host** reads it in
`src/host/config.ts` — and in one other place, which the table below makes
explicit: the pilot-era `MQTT_*` credential fallback inside the unmodified
`src/rtu-config.js`, reached through `resolveMqttConnection`. That fallback is
currently the only working credential path, and Resolved decision 5 keeps it
past cutover: no RTU has an `rtu_connection_configs` row to read instead.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | — | Required. |
| `INGEST_NOTIFY` | `off` | `on` \| `off` only. **Compose sets `on`, and since the cutover that is required, not optional — see below.** Any other value is refused at startup rather than guessed at. |
| `INGEST_HOST_HEALTH_PORT` | `9103` | The default is deliberately *not* `INGEST_METRICS_PORT` — `src/index.js` holds `9102`, and a parallel run needs both. **Compose sets it to `9102`** so the published port means the same thing whichever process runs; run a side-by-side comparison outside compose, on the default. |
| `INGEST_RELOAD_MS` | `60000` | How often point mappings are refreshed. Matches `index.js`. |
| `MQTT_HOST` / `MQTT_PORT` / `MQTT_USERNAME` / `MQTT_PASSWORD` | pilot-era | MQTT **only**, resolved by the host through the unmodified `src/rtu-config.js`. No new adapter gets an environment fallback. |
| `MQTT_TLS_REJECT_UNAUTHORIZED` | on | Only the exact string `false` disables TLS verification, matching `index.js`. |
| `CREDENTIAL_ENCRYPTION_KEY` | — | ADR 0012. Without it, encrypted per-RTU credentials are simply not read. |

### `INGEST_NOTIFY` defaults to **off** — and since the cutover that default is the *dangerous* direction

The default exists for the parallel window. While two processes ran, both wrote
the same rows through `ON CONFLICT (time, asset_id, point_key) DO UPDATE`, so
concurrent *writes* were idempotent. Concurrent `pg_notify` is not:
`telemetry-notify.service.ts` holds a `LISTEN bms_telemetry` and fans every
payload to Socket.IO, so two notifying processes deliver **every PHE reading to
the live dashboards twice**. Off by default meant a stray `pnpm start:host`
could not double the dashboards.

**That safety argument inverted at the cutover.** The host is now the only
ingest process, so nothing can double anything, and the flag is what stands
between the pilot and silent realtime death: unset it, typo it, or lose the
`environment:` entry from the compose service while `command:` stays, and rows
keep landing while every dashboard goes dead. There is no error and no alarm —
the only signal is `notify=off` in the health body. `INGEST_NOTIFY: "on"` in
`docker-compose.yml` is now **required configuration, not a preference**.

Quote it. Unquoted `on` is YAML boolean `true`, and `readHostConfig` refuses it.

ADR 0016 §6 **deletes this flag in commit 4**, which is now the change that
removes the failure mode rather than merely tidying up. It must not survive as a
permanent way to run ingest with realtime silently off.

## Health endpoint

Plain text, on `INGEST_HOST_HEALTH_PORT`. No metrics library — `prom-client`
is deferred to `F1.10` / `F3.16` (ADR 0016 §Dependencies).

```
ingest-host degraded endpoints=1 rtus=1 skipped=0 notify=off uptime=39s
endpoint protocol=mqtt key=phe.thinkiot.co.in:8883 state=disconnected rtus=861736076104923 restarts=1 pollFailures=0 queue=0 dropped=0 written=0 writeFailures=0 lastSample=never
```

- One `endpoint` line per supervised connection. `rtus=` enumerates the devices
  that genuinely share it and would fail together — the blast radius.
- `skipped` lines name every RTU left out and why (`no-adapter`,
  `unsupported-protocol`, `missing-rtu-code`, `invalid-connection-config`, …),
  so a gateway that never appears is visible without reading the log.
- `dropped` and `writeFailures` are the loss counters. They are the signal that
  a database outage is costing telemetry; durable buffering across one is
  `F1.10`, not this.

Logs are JSON lines on stdout. Credential values never appear in them — the
adapter conformance suite asserts it with a seeded sentinel.

## Running the ADR 0016 §6 commit 3 parallel verification

The point of the exercise is to prove the host writes what the legacy process
writes, before anything is cut over.

**This procedure ran on 2026-08-06 and step 4 was taken** — it is kept as the
recipe for re-running the comparison, not as pending work. Since the compose
`ingest` service now runs the host, step 1 is no longer "leave it as it is": you
must put the *legacy* process back first, by removing the `command:` override
(or overriding it to `["pnpm", "start"]`) and recreating the container. That
recreate costs one message, the same as the cutover did.

1. Get the legacy process running as the compose `ingest` service — see above.
2. Build, then start the host **against the same database**, with notify off
   and its own health port (leave `INGEST_HOST_HEALTH_PORT` unset so it takes
   the 9103 default; compose pins the deployed process to 9102):

```bash
pnpm --filter ingest build
```

```bash
cd apps/ingest && DATABASE_URL="$DATABASE_URL" INGEST_NOTIFY=off pnpm start:host
```

3. Over the window, compare row counts, timestamps and per-RTU sample rates in
   `telemetry.point_values`. Both processes upsert the same primary key, so
   agreement means the host resolved the same points from the same payloads.
   **Expect exactly one difference: `network_strength`.** See *Deliberate
   divergences* below — a run that shows agreement on that point means the host
   is on a build older than 2026-08-06, and a run that shows any *other*
   difference is a finding.
4. Only then set `INGEST_NOTIFY=on` **and** flip the compose `ingest` service to
   `command: ["pnpm", "start:host"]` in the same step, stopping the legacy
   process. The image must already contain `dist/main.js` — an image built
   before the `pnpm build` step was added to `apps/ingest/Dockerfile` gives a
   crash loop, not a fallback, so rebuild before recreating. Reverting is
   deleting one compose line — no image rebuild and no code edit, though it
   still costs the one-message recreate gap.

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
- **`INGEST_NOTIFY: "on"` is now required configuration.** With one ingest
  process there is nothing to double, so the flag no longer protects anything —
  it is the only thing keeping realtime alive. Losing it fails silently: rows
  keep landing, dashboards go dead, and the sole signal is `notify=off` in the
  health body. See the `INGEST_NOTIFY` section above.
- **One message was lost to the container restart**, the minute between the
  legacy process's last write and the host's first. Recreating the container is
  not a hot swap; a cutover run during a maintenance window would cost the same
  minute. The gap is a genuine hole in the series, not a display artefact.

## Deliberate divergences from `index.js`

`index.js` is frozen under ADR 0016 §6 while it runs the pilot, so a defect
found in the shared parse logic can only be fixed on the host side. Two
behaviours therefore differ **on purpose**. Both are in
`apps/ingest/src/adapters/mqtt.ts`; neither is a porting error.

| Divergence | Host | `index.js` |
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
cutover was taken on 2026-08-06 rather than left pending. A pilot running
`pnpm start` loses `network_strength` every minute.

## Known limits in this build

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
