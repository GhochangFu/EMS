# The ingest host

Operator notes for `apps/ingest`'s second entry point, added by `F1.1`
(**[ADR 0016](./adr/0016-ingest-adapter-framework.md)**).

## Why there are two entry points

`apps/ingest` currently ships two programs:

| | Command | What it is |
| --- | --- | --- |
| Legacy | `pnpm start` → `node src/index.js` | The live PHE MQTT pilot (ADR 0007). **Frozen** — not one line edited by `F1.1`. |
| Host | `pnpm start:host` → `node dist/main.js` | The pluggable adapter host. Serves MQTT today; `F1.2`–`F1.6` add protocols. |

This is the strangler migration in ADR 0016 §6, and the two coexist
deliberately. The legacy process stays the one `pnpm start` runs, and the
compose `ingest` service still runs it, until the cutover (§6 commit 4) —
which **needs a named owner** (ADR 0016 Resolved decision 4). Until someone
owns deleting `src/index.js`, the two-entry-point window stays open, and that
duplication becoming permanent is the realistic failure mode of a strangler.

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
| `INGEST_NOTIFY` | `off` | `on` \| `off` only. **See below.** Any other value is refused at startup rather than guessed at. |
| `INGEST_HOST_HEALTH_PORT` | `9103` | Deliberately *not* `INGEST_METRICS_PORT` — `src/index.js` holds `9102`, and the parallel run needs both. |
| `INGEST_RELOAD_MS` | `60000` | How often point mappings are refreshed. Matches `index.js`. |
| `MQTT_HOST` / `MQTT_PORT` / `MQTT_USERNAME` / `MQTT_PASSWORD` | pilot-era | MQTT **only**, resolved by the host through the unmodified `src/rtu-config.js`. No new adapter gets an environment fallback. |
| `MQTT_TLS_REJECT_UNAUTHORIZED` | on | Only the exact string `false` disables TLS verification, matching `index.js`. |
| `CREDENTIAL_ENCRYPTION_KEY` | — | ADR 0012. Without it, encrypted per-RTU credentials are simply not read. |

### `INGEST_NOTIFY` defaults to **off**

Both processes write the same rows through
`ON CONFLICT (time, asset_id, point_key) DO UPDATE`, so concurrent *writes* are
idempotent. Concurrent `pg_notify` is not: `telemetry-notify.service.ts` holds
a `LISTEN bms_telemetry` and fans every payload to Socket.IO, so two notifying
processes deliver **every PHE reading to the live dashboards twice**.

The host therefore writes and counts but stays silent until told otherwise.
A stray `pnpm start:host` cannot double the dashboards.

ADR 0016 §6 **deletes this flag in commit 4**. It must not survive as a
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

1. Leave the legacy `ingest` compose service running as it is.
2. Build, then start the host **against the same database**, with notify off
   and its own health port:

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
   process. Reverting is deleting one compose line — no image rebuild, no code
   edit.

### Result of the 2026-08-06 run

Run against the live Bhutnirghat I feed the day the pilot was first brought up,
on the build immediately before the `network_strength` fix — so it is a
like-for-like comparison. The RTU publishes once a minute, which makes the
windows clean. **Step 4 was not taken**; the compose service still runs the
legacy process.

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
the RTU's 22 mapped points landed. The host on a post-2026-08-06 build writes 21
samples per message where `index.js` writes 20.

**This is the standing argument for completing the cutover.** Every day the
compose service runs `pnpm start`, the pilot loses `network_strength`.

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
