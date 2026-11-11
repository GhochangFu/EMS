# The ingest host

Operator notes for `apps/ingest`, whose one entry point is the pluggable adapter
host from `F1.1` (**[ADR 0016](./adr/0016-ingest-adapter-framework.md)**).

## One entry point, as of §6 commit 4

| Command | What it is |
| --- | --- |
| `pnpm start` → `node dist/main.js` | The pluggable adapter host, and what the pilot runs. Serves MQTT today; `F1.2`–`F1.6` add protocols. |
| `node dist/edge-main.js` | The edge gateway (`E7.2`, ADR 0016 Amendment 9 (c)): same image, reaches no database — see [`edge-gateway.md`](./edge-gateway.md). |

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
explicit: the pilot-era `MQTT_*` credential fallback inside `src/rtu-config.js`,
reached through `resolveMqttConnection`. That fallback is
still the only working credential path (ADR 0016 Amendment 3).

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | — | Required. |
| `INGEST_HOST_HEALTH_PORT` | `9103` | **Compose sets it to `9102`** inside the container; since `F4.61` it is not published to the host (see *Reachability* below). The default is 9103 rather than 9102 for a historical reason: the ADR 0007 entry point bound 9102 as `INGEST_METRICS_PORT` and §6 commit 3 needed both processes up at once. That entry point is gone, but the separate default is kept so two hosts side by side still need only one variable set. |
| `INGEST_RELOAD_MS` | `60000` | How often point mappings are refreshed. Matches what the ADR 0007 pilot did. |
| `INGEST_STALE_AFTER_MS` | `300000` | Silence longer than this marks one RTU `stale` on the health endpoint (`F1.7`). Five minutes because the fleet was measured, not guessed: the nine live PHE RTUs publish every ~60 s (probe, 2026-08-22, 600 s window), so this is five missed cycles — a single dropped message can never raise it. Widen it for a protocol that polls far more slowly than MQTT pushes. |
| `MQTT_HOST` / `MQTT_PORT` / `MQTT_USERNAME` / `MQTT_PASSWORD` | pilot-era | MQTT **only**, resolved by the host through `src/rtu-config.js`. No new adapter gets an environment fallback. |
| `MQTT_TLS_REJECT_UNAUTHORIZED` | on | Only the exact string `false` disables TLS verification, as in the ADR 0007 pilot. Not applied to a plain-MQTT endpoint, which has no TLS to verify. |
| `MQTT_PLAINTEXT_HOSTS` | empty | ADR 0114 (`F4.326`). Comma-separated broker host names an MQTT RTU may reach **without TLS**. Plain needs both the literal `tls: false` in the RTU's stored config and its resolved host (stored, or the `MQTT_HOST` fallback) on this list — see *Plain MQTT* below. Trimmed, lower-cased, exact match; no wildcard, port, IPv6 or range. A bad entry refuses start-up with `MQTT_PLAINTEXT_HOSTS entry <n> is not a host name` — the position, never the text. Set the same value on `api` and `worker`. |
| `CREDENTIAL_ENCRYPTION_KEY` | — | ADR 0012. Without it, encrypted per-RTU credentials are simply not read. |
| `INGEST_BUFFER_DIR` | `/var/lib/bms-ingest` | Where a batch the database refused lands (`F1.10`, ADR 0016 Amendment 4 ruling 4). Blank or unset takes the default; compose mounts a named volume at that path. **Must be absolute** — a relative value would resolve against the container working directory, putting the buffer on the writable layer with the volume unused, which nothing downstream can detect. A directory that cannot be created, that fails a write-and-unlink probe, or whose listing fails refuses host start-up with the path in the error — there is no "no buffer" mode. |
| `INGEST_BUFFER_MAX_AGE_MS` | `3600000` | How long a spilled segment survives, by receipt minute, before the age bound erases it. Strictly older than the bound is erased; exactly the bound is kept. Ceiling `2^31-1`, the same timer limit `INGEST_RELOAD_MS` and `INGEST_STALE_AFTER_MS` share. |
| `INGEST_BUFFER_MAX_BYTES` | `268435456` | Total bytes the on-disk buffer may hold, host-wide across every endpoint, before the byte bound erases the oldest segment. Ceiling `2^40` (1 TiB) — a fact about a disk, not about integers. |
| `INGEST_NOTIFY_LIVE_WINDOW_MS` | `300000` | ADR 0123 decision 10 (`E7.2`). How old a written row's `time` may be and still be notified on `bms_telemetry`; an older row is written as history and not notified (see *Realtime has no switch* below). Defaults to the shared `NOTIFY_LIVE_WINDOW_MS`. Accepted from `60000` to `900000`; anything else, `0` included, refuses start-up with the variable and its bounds in the error. |
| `INGEST_UPLINK_PORT` | unset (off) | ADR 0123 decision 4 (`E7.2`). The edge uplink receiver's port, `POST /edge/v1/batches` — see *The uplink receiver* below. Unset or blank starts no listener. Same digits-only rule as the health port, `1`–`65535`, and it must differ from `INGEST_HOST_HEALTH_PORT`; either mistake refuses start-up naming the variable. |
| `INGEST_UPLINK_MAX_SAMPLES_PER_S` | `2000` | Security review M2. Samples per second one edge gateway may post; a batch that would overdraw its bucket is `429 rate-limited` with `Retry-After`. `500`–`100000`: the floor is one full batch, so a batch can always be admitted. Four times the edge's own replay cap (`EDGE_REPLAY_MAX_SAMPLES_PER_S`, 500). |
| `INGEST_UPLINK_MAX_CONNECTIONS` | `256` | Security review L2. `server.maxConnections` on the uplink listener. `1`–`10000`. |
| `INGEST_HEALTH_FLUSH_MS` | `10000` | ADR 0127 decision 16 (`F3.16`). How often the device-health heartbeat and counters are flushed — see [`ingest-device-health.md`](./ingest-device-health.md). `1000`–`15000`, so at least two beats land inside the API's 30 s host-stale bound; anything else refuses start-up naming the variable. |
| `INGEST_HOST_KEY` | `cloud` | ADR 0127 decision 10 (`F3.16`). This host's row in `bms.ingest_hosts`, and the `host_key` on the RTU rows it writes. Trimmed; `[a-z0-9-]{1,64}` or start-up is refused. Two hosts must not share a key. |

`INGEST_BUFFER_MAX_AGE_MS` and `INGEST_BUFFER_MAX_BYTES` parse through the
same digits-only, safe-integer rule as `INGEST_RELOAD_MS` and
`INGEST_STALE_AFTER_MS` (`config.ts`'s `positiveInt`) — `"1e21"`, `"0x493e0"`
and a blank string are all refused or defaulted the same way; each variable
just states its own ceiling.

**Deleted at §6 commit 4, and not merely defaulted:** `INGEST_NOTIFY`,
`INGEST_METRICS_PORT` and `MQTT_RECONNECT_MS`. The last two were read only by the
deleted entry point — the host owns its own reconnect (exponential, jittered) and
binds `INGEST_HOST_HEALTH_PORT`. A copy left in an old `.env` is inert; the specs
assert that rather than leaving it to be discovered.

### Realtime has no switch, and that is the point of commit 4

The host emits `pg_notify('bms_telemetry', …)` for **every row inside the live
window**. There is no flag, no option and no default that can turn that off.

**The one gate is the row's own time** (ADR 0016 Amendment 9, ADR 0123
decision 10, `E7.2`). A row whose `time` is more than
`INGEST_NOTIFY_LIVE_WINDOW_MS` (default 5 minutes) before the host's clock is
written and **not** notified: a replay after an outage, from the `F1.10` disk
buffer or from an edge gateway, lands in history without raising a live alarm
or moving a live tile backwards. Alarms are not evaluated retrospectively. The
rule is the same one the API applies to a backdated manual entry
(`NOTIFY_LIVE_WINDOW_MS`, `@bms/shared/ingest`). The window is bounded to
60 s – 15 min and the host refuses to start outside it, because a window of 0
would be the deleted flag under a new name. A batch that held rows back logs
`rows written outside the live window, not notified` with the count.

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
  notifying a live row, so `writeResolved` either does both or throws, and a
  failing `pg_notify` lands in `writeFailures=` rather than passing silently. A
  rising `written=` on live traffic is therefore evidence that notifications are
  flowing; `notify=on` is not. While `replayed=` is climbing, part of `written=`
  is history the live window held back, by design.
- **The same silent outage is still reachable one hop downstream.** The API's
  `telemetry-notify.service.ts` holds the `LISTEN bms_telemetry` with no error
  handler and no reconnect, so a dropped listener connection gives dead
  dashboards with healthy ingest — `notify=on`, `written=` climbing, nothing in
  the logs. That is pre-existing and outside this host; it has its own backlog
  row. If dashboards are dead and ingest looks healthy, suspect the listener.

## Health endpoint

Plain text, on `INGEST_HOST_HEALTH_PORT`. No metrics library — `prom-client`
is deferred to `F3.16` (ADR 0016 Amendment 4 decision 11). Identifiers
(`rtuCode`, `endpointKey`, `sourceKey`, a skip's `rtu=` and `detail=`) outside
the safe set `A-Za-z0-9._-:/` are percent-encoded as UTF-8 bytes, `%` included,
so every record stays one line.

**Reachability (`F4.61`, ADR 0016 Amendment 8).** The body names every enabled
RTU and when each last reported, without authentication, so who may ask is
narrowed at three boundaries. The handler (`refuseHealthRequest` in
`apps/ingest/src/host/health-server.ts`) answers `GET /` and `GET /health`
only, exactly — a query string or a trailing slash is another path — and only
for exactly one loopback `Host`: `localhost`, `127.0.0.1` or `[::1]`, each with
an optional `:port`, case-insensitive; a missing or repeated `Host` is refused.
It checks the
`Host` first, so a page rebound to `127.0.0.1` in an operator's browser is
refused whatever else it sends. A refusal is `421` (host), `405` with
`Allow: GET` (method) or `404` (path), each with a fixed one-line body
(`refused: host`, `refused: method`, `refused: path`) that never carries the
roster, never echoes what it refused, and never starts with `ingest-host` — a
check matching that prefix cannot pass on a refusal. In compose, the `ingest`
service sits on its own network `ingest`, shared with `postgres` only, so no
other container can resolve it, and the port is **not published to the host**:
on Docker Desktop a port on the host's `127.0.0.1` is reachable from every
container through `host.docker.internal`. `tests/f4.61-ingest-network-isolation.test.ts`
holds both. Read the page from inside the container — the image's busybox
`wget` sends a loopback `Host`:

```
docker compose exec ingest wget -qO- http://127.0.0.1:9102/
```

`curl 127.0.0.1:9102` on the host no longer answers. A compose `healthcheck:`
added later must call `http://127.0.0.1:9102/` from inside the container too —
`http://ingest:9102/` sends a foreign `Host` and gets `421`.

```
ingest-host degraded endpoints=1 rtus=3 stale=1 dark=1 skipped=0 notify=on uptime=39s
endpoint protocol=mqtt key=phe.thinkiot.co.in:8883 state=connected writePath=ok rtus=861736076104923|861736076128245|861736076133666 restarts=1 pollFailures=0 queue=0 dropped=0 written=812 writeFailures=0 buffered=0 bufferDropped=0 replayed=0 lastSample=2026-08-22T09:41:07.000Z
stopped protocol=mqtt key=shapoorji.thinkiot.co.in:8883 buffered=1240
stale rtu=861736076133666 endpoint=phe.thinkiot.co.in:8883 lastSample=never
dark rtu=861736076128245 endpoint=phe.thinkiot.co.in:8883 key=s12_r01 lastSample=never
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
- **One `dark rtu=` line per bound point that has gone quiet on an RTU that is
  not itself stale** (`F4.58`). Format: `dark rtu=<rtuCode> endpoint=<endpointKey>
  key=<sourceKey> lastSample=<iso|never>[ silentFor=<n>s]` — one line per
  `(rtuCode, sourceKey)`, following the `stale rtu=` lines. `stale` already says
  the whole device stopped talking, so a point on a stale RTU is **neither
  listed nor counted** here — repeating every one of that RTU's bound keys as
  `dark` too would say the same fact under two names and drown the case this
  line exists for: a station still talking, just not about everything it is
  mapped to. Same clock as `stale`: silence is measured from
  `max(lastSampleAt, startedAt)`, strictly greater than
  `INGEST_STALE_AFTER_MS` — the same window and the same boot grace, so a point
  that has never published is not falsely dark before the host has been up
  long enough to have heard it, and one publishing exactly on the boundary does
  not flap. At most `MAX_DARK_LINES` (50) lines render; beyond that a trailer
  `dark omitted=<k>` names the rest — the header's `dark=<n>` is always the
  true total, never capped, so an operator counting from the header is never
  undercounting. **`dark>0` does not change the `ok`/`degraded` verdict.**
  Unlike `stale`, a dark point is a station demonstrably still connected and
  still publishing something — the alarm for "this whole RTU went quiet" is
  `stale`, and folding a partial gap into the same verdict would degrade the
  host on the ordinary case of one dead sensor on an otherwise healthy RTU,
  which is `F3.16`'s alarm surface to own, not this endpoint's boolean.
- **The device list follows the database at each reload** (ADR 0115 decision
  6, `F4.330`). Enabling or disabling an RTU, or switching its organization's
  ingest off or on, needs **no restart**: within one `INGEST_RELOAD_MS` (60 s by
  default) plus the broker reconnect, the endpoint is started, replaced or
  stopped and `rtus=` shows the new roster — see *Reloads* below. Until ADR
  0115 the list was fixed at start-up, so a newly enabled RTU was absent from
  `rtus=` and a newly disabled one eventually read `stale`.
- **One `stopped` line per endpoint a reload stopped that still holds samples
  on disk** (ADR 0115 decision 7): `stopped protocol=<p> key=<endpointKey>
  buffered=<n>`, after the `endpoint` lines and before `stale`. `n` is
  **samples**, the same unit as every other `buffered=` here. Those segments
  are kept on purpose and replay when the endpoint next starts, so the line
  **does not change the `ok`/`degraded` verdict**; it is there so nothing on
  disk is hidden, and it goes once the backlog is replayed or swept. A stopped
  endpoint with nothing buffered is not listed. **It survives a restart**
  (ADR 0115 Amendment 1): at boot the host lists every endpoint the
  disk-buffer scan found segments for that the boot plan does not start — an
  organization still switched off — so a backlog never drops off the page just
  because the process restarted.
- `skipped` lines name every RTU left out and why (`no-adapter`,
  `unsupported-protocol`, `missing-rtu-code`, `invalid-connection-config`,
  `tls-downgrade-refused`, `plaintext-host-not-allowed`,
  `endpoint-config-conflict`, `organization-ingest-disabled`,
  `payload-format-unknown`, `payload-format-invalid`,
  `payload-format-conflict`, …), so a gateway that never appears is visible
  without reading the log. The three `payload-format-*` reasons are ADR 0116's
  (see *Payload formats* below): `-unknown` and `-invalid` carry the format
  code as `detail=`, `-conflict` carries the topic.
  `organization-ingest-disabled` (ADR 0115 decision 5) carries the
  organization code as its `detail=` — `skipped rtu=<code>
  reason=organization-ingest-disabled detail=BCPL` — and is decided before any
  other reason, so a switched-off organization's RTU with a broken config still
  reads as switched off. An RTU whose own *Ingest enabled* box is off is not in
  the binding query at all and is not listed, as before. Since `F4.339` (ADR
  0117 decision 8) neither is an inactive RTU: deactivating one releases its
  MQTT topic, so it never reaches the plan and has no skip reason. The `skipped` lines
  are rebuilt at every reload; the `rtu skipped` log line is written at boot
  only.
- `dropped` is the memory tier's loss — the in-memory queue dropping oldest
  because it filled before anything could be written or spilled.
  `bufferDropped` is the disk tier's loss — a segment erased by an age or byte
  bound, an unparseable crash-truncated line, or a batch whose disk append also
  failed. `writeFailures` counts every failed database write, live or replay —
  it is the signal that a database outage is costing telemetry, and it keeps
  moving for the whole outage because a replay probe that fails is also a
  failed write. `buffered` is a gauge, not a counter: samples sitting on disk
  right now, host-wide `> 0` degrades the verdict even while every endpoint
  stays `state=connected` — the connection is fine, the database is not.
  `replayed` is the lifetime count of samples the backlog has landed. See
  *The disk buffer* below.
- **`writePath=` says where the last batch went, and it is the second thing
  that degrades the host.** `ok` — it was written, live or from the backlog.
  `buffering` — the breaker is open and it went to disk; the database is down
  and nothing is lost. `losing` — it was neither written **nor** spilled, so it
  is gone: the disk is refusing writes too. `buffered=` cannot see that last
  case, because nothing reached the disk to be counted — the gauge reads 0, the
  endpoint reads `connected`, every RTU is fresh, and before `writePath` the
  host reported `ok` while telemetry was being destroyed. Both non-`ok` states
  clear themselves: the next successful write returns it to `ok`, which is why
  the verdict reads this and not the lifetime `bufferDropped`.

Logs are JSON lines on stdout. Credential values never appear in them — the
adapter conformance suite asserts it with a seeded sentinel.

**The `readings absent` log line — why a dark point went dark** (`F4.58`,
`apps/ingest/src/adapters/mqtt.ts`). The health endpoint's `dark` line can only
say *which* bound point stopped producing a reading — the host never sees the
payload, only the samples the adapter chose to emit. The distinction between a
dead sensor and a wrong mapping lives here instead: the MQTT adapter emits one
`warn("readings absent", { rtuCode, deviceKey, empty, missing, firstEmpty?,
firstMissing? })` per message, for every affected station, whenever at least
one bound key yields no sample.

- `empty` is the count of bound keys the payload carried as `null`, `""`, or a
  value that will not coerce to a finite number — the register answered with
  nothing usable. This is a field fault: the meter or sensor behind that key is
  not reporting.
- `missing` is the count of bound keys **not present in the payload at all**
  (`undefined`). This is a mapping fault: `source_data_key` names a key this
  device never publishes.
- `firstEmpty` / `firstMissing` name the first key of each kind, in binding
  order, and are omitted when their count is 0.
- Ids and counts only — never a value (AGENTS.md §9.6). One line per message
  per affected station, stateless and timer-free: a message with every bound
  key present logs nothing.

## Reloads

Every `INGEST_RELOAD_MS` (60 s by default) the host re-reads the binding query,
re-plans, and reconciles the running endpoints with the plan
(`src/host/reconcile.ts`, ADR 0115 decision 6, amending ADR 0016). Per
`(protocol, endpointKey)`:

| Plan vs. running | Action | Log line (`info`) |
|---|---|---|
| In the plan, not running | build and start a supervisor | `endpoint started` |
| Running, device set changed | `stop()` the old supervisor, **then** build and start a new one | `endpoint replaced` with `added`/`removed` device keys |
| Running, same device set, decoder fingerprint changed (ADR 0116 decision 6) | the same replace | `endpoint replaced` with `reason=payload-format-changed` |
| Running, not in the plan (no enabled RTU left) | `stop()` it — the broker connection closes and the endpoint leaves the roster | `endpoint stopped` |
| Running, same device set | swap the point index only | none |

- **Stops and replaces run before starts**, and a replace waits for the old
  `stop()` before it dials — up to about 15 s (the adapter's 5 s disconnect
  timeout plus the supervisor's 10 s settle). The old connection is closed
  before the new one is dialled, which is what makes "only that broker
  reconnects" true. For MQTT that is every RTU on that broker, including other
  organizations' RTUs that share it — a reconnect gap of a few seconds,
  longer if the old disconnect hangs.
- **Reloads never overlap.** A tick that arrives while the previous one is
  still running — its binding query, its apply or its sweep — is skipped, and
  the first skip of a run logs `warn` `reload tick skipped; previous tick still
  running`. Nothing is queued, because the next tick re-plans from the
  database anyway, and so a slow query can never apply an older plan over a
  newer one. The registry also refuses an overlapping apply on its own
  (`reload skipped; previous reload still applying`) as a second guard.
- **A failure stays with its endpoint.** A build that throws is logged as
  `endpoint start failed` with its key and retried at the next reload; a stop
  that fails is logged as `endpoint stop failed` and the endpoint is still
  dropped. The other actions in the same reload still apply. A reload that
  cannot read the database logs `binding reload failed` and changes nothing.
- **After applying, the tick sweeps the disk buffer** (`bufferStore.sweep()`),
  so the 1 h / 256 MiB bounds keep running when no supervisor is left to sweep.
- **Still restart-only:** a change of connection config or credential on an
  endpoint whose device set is unchanged is a point-index swap, not a replace
  (ADR 0115 decision 6, plan R5) — detecting it would mean fingerprinting the
  decrypted credentials. See *Known limits*.

**Time to effect** of the organization switch and of an RTU's *Ingest enabled*
box: within one `INGEST_RELOAD_MS` plus the reconnect.

### Payload formats (ADR 0116, `F4.334`)

An MQTT message is decoded with a **payload format** from the platform catalog
`bms.mqtt_payload_formats`. An RTU names one by code in its connection config
(`rtu_connection_configs.config.payloadFormat`); an RTU that names none uses the
built-in `thinkiot-envelope`, whose decoder is `parseMqttEnvelope` unchanged, in
code — it never needs the catalog row, so every PHE RTU behaves as before.

- The binding query `LEFT JOIN`s the catalog on the named code. The host
  validates the joined definition with the shared schema and writes it onto the
  binding's device slice; a `payloadFormat` object stored inside
  `config.device` is always overwritten, so stored JSON can never supply its
  own definition.
- **Per topic.** The adapter decodes each message with the format of the topic
  it arrived on (`decodeMqttPayload`). The `MAX_PAYLOAD_BYTES` check runs
  first, and every decoded record still goes through the `F1.7` topic check
  (`device is not bound to this topic`). A message the format cannot decode
  logs `warn` `mqtt payload not decoded topic=<t> formatCode=<code>
  reason=<not-json|root-mismatch|no-device-key|too-many-records|binary-length-mismatch>`
  — never the payload. The built-in path keeps `mqtt payload was not valid JSON`.
- **Binary formats** (ADR 0119, `F4.343`). The adapter passes the payload
  bytes, not a UTF-8 string, so a `binary` format reads a fixed-length record
  with byte positions, types and sentinels. Its device key is the topic (one
  topic = one RTU, ADR 0119 R4), and a frame of any other length is dropped
  with `reason=binary-length-mismatch`.
- **Skips.** A code with no catalog row is `payload-format-unknown`; a row whose
  definition fails the schema is `payload-format-invalid`; a second RTU on the
  same endpoint **and topic** naming a different format is
  `payload-format-conflict` (the first stays served). RTUs whose topic is
  their own `rtus.mqtt_topic` are planned before RTUs that borrow a topic
  through a stored `config.device.topic`, so the topic's owner is always the
  first; a skipped RTU never supplies the endpoint's credentials. RTUs on different topics
  of one broker may use different formats and share the connection.
- **Edits reach a running endpoint without a restart.** Each endpoint plan
  carries a `decoderFingerprint` (sha256 over its bindings' topic, format code
  and definition — no secret). A reload whose device set is unchanged but whose
  fingerprint moved replaces the endpoint: `endpoint replaced …
  reason=payload-format-changed`, within one `INGEST_RELOAD_MS`. Editing a
  format's name or description does not move it. A binding's topic is part of
  the fingerprint, so a topic change on an unchanged device set now replaces
  the endpoint too, under the same reason.
- **The device key is the RTU code.** A decoded record's device key is matched
  against `rtus.rtu_code` (ADR 0116 decision 7): for BCPL the RTU code is the
  `TagName`. A format with no device-key path uses the **topic** as the key, so
  the RTU code must then equal the topic string — up to the 64-character RTU
  code limit.

## The disk buffer

`F1.10` (ADR 0016 Amendment 4, `apps/ingest/src/host/disk-buffer.ts`). It
survives a database outage — it does not survive a broker outage; that is
`E7.2` and is a different problem, on the other side of the adapter.

**Path and format.** Each endpoint's spilled batches land at
`<INGEST_BUFFER_DIR>/<protocol>/<encodeURIComponent(endpointKey)>/<epoch-minute>.jsonl`
— for the pilot, `mqtt/phe.thinkiot.co.in%3A8883/<minute>.jsonl`. Each line is
one `SourceSample` plus its receive time, written as an explicit field
whitelist — `sourceKey`, `value`, `deviceKey` (when the sample carried one),
`at` (only when the device sent a readable timestamp — the device time and
nothing else), `rx` (always, ISO-8601 — the instant the host received the
sample), `good` (when present) — never `JSON.stringify` of the whole object, so
a credential or any other field a future adapter might attach cannot reach disk
by accident. **`rx` is the receive time the failed write used, written once at
spill and never rewritten** (ADR 0016 Amendment 5) — not the append instant,
which can be `writeTimeoutMs` later while the timed-out write still lands.
That is why a replayed row lands where the live path put it — `time` is the
receive time since ADR 0061 — and why replaying the same segment twice is safe:
both writes target the same `(time, asset_id, point_key)` and the second is an
`ON CONFLICT DO UPDATE`, not a duplicate. `at` is never substituted: a stamp
there would reach `device_time` as a clock the device never reported. A segment
written before Amendment 5 (`at`, no `rx`) cannot be read — nothing says whether
its `at` was a device time or a stamp — so it is skipped and counted in
`bufferDropped`; the deploy gate is `buffered = 0` before the image goes out.
Because the buffer is written before normalisation, a point mapping fixed
during the outage applies to the whole backlog when it replays — the backlog
is not frozen to a stale mapping.

**The two bounds.** `INGEST_BUFFER_MAX_AGE_MS` (default 1 h) erases a segment
strictly older than the bound, by receipt minute — exactly the bound is kept.
`INGEST_BUFFER_MAX_BYTES` (default 256 MiB) is host-wide across every
endpoint: once the total exceeds it, the oldest segment across *all*
endpoints is erased, oldest first, regardless of which endpoint owns it. Both
erasures count into that segment's endpoint's `bufferDropped`, and both are
logged once per segment at `warn`.

They are applied after every append — **including one that failed**, which is
then retried once, so a disk that filled is not left full for ever — and on a
**sweep** the replay loop performs once a minute, whether or not the buffer is
empty. The sweep is what makes the age bound a rolling hour rather than a
rolling hour *of appends*: an endpoint whose broker went down, or whose RTUs
were disabled, stops appending, and nothing else would ever look at its last
segments again — and the case that needs it most is the broker down *and* the
database down, where the buffer is **not** empty and still nothing appends. So
the hour holds to within a minute of itself.

**A segment the host cannot read is retired.** Three consecutive failed reads
(anything but "the file is gone") and it is unlinked, its lines counted into
`bufferDropped`, and one `error` line names it. Without that ceiling it is
immortal: the replay loop retries it for ever and `buffered>0` keeps the host
degraded with nothing able to clear it. The replay loop backs off between
those attempts on the same §5 schedule the probe uses, rather than re-reading
five times a second.

**An erasure that the volume refuses does not pretend to have happened.** The
file is unlinked first and the record dropped only once it is gone, so a
read-only remount or a Windows lock cannot leave the store counting bytes that
are no longer bounded, or `bufferDropped` counting samples that are still on
disk. From then on that record is **skipped** — by both bounds and by replay —
so the byte bound goes on to the next-oldest segment and the endpoint's later
segments still replay: one refused file costs that file, not the store. Its
bytes still count and its lines still show in `buffered`, and one `error` line
names it once (a second refusal is silent). It is cleared by an operator — or
by an append that reaches the same file, which is a spill landing in the same
receipt minute the refusal happened in: a record nothing offers is a record
nothing can unlink, so without that second exit the batch that append wrote
would sit in `buffered` and never replay.

**One bad file is skipped; one bad directory refuses start-up.** The start-up
scan measures each candidate and leaves alone, with one `warn`, any file
bigger than `INGEST_BUFFER_MAX_BYTES` or that it cannot read; those files are
not counted, replayed or erased. A directory it cannot list is still fatal,
with the path in the message (ruling 4) — a subtree the store cannot enumerate
is a backlog it can neither replay nor bound.

**Directories are created `0700` and segment files `0600`**, so on a POSIX
host only the account running the ingest process can read the plant telemetry
on the volume. Windows ignores both.

**The store's queue is one queue for the whole host.** The *accounting* is per
endpoint — segments, `buffered` and `bufferDropped` belong to the endpoint that
produced them — but every filesystem operation runs through a single promise
chain, because a spill racing an erasure on one segment is a silent loss. So a
slow append on one endpoint delays every other endpoint's spill and replay.
Per-endpoint isolation is about the *bookkeeping* and the blast radius of a
failing adapter, not about the disk.

**The state machine.** A batch the database refuses is appended to disk; only
once that append succeeds does the endpoint enter *buffering* (if the disk
append also fails there is nothing to replay, so the endpoint stays on the
live path and the batch is counted lost, as it was before `F1.10`). While
buffering, every later batch goes straight to disk with no database attempt —
attempting each one would cost a full `writeTimeoutMs` and starve the
in-memory queue into drop-oldest, which is the failure this feature exists to
avoid. A replay loop retries the oldest segment on the same backoff every
other retry in this host uses (§5: 1 s, doubling, capped at 60 s, ±20%
jitter), and that retried write **is** the probe — there is no separate
health check. The first successful write clears buffering: live batches
resume immediately, and the backlog drains oldest-first, one batch at a time,
with a `drainIdleMs` (200 ms) pause between batches so a long backlog cannot
starve the live path either. A segment is unlinked only after every
parseable line in it has been written; a failure partway through leaves the
segment in place for the next pass, so a crash or a renewed outage mid-segment
re-replays at most one minute of samples, and idempotently.

**Crash safety.** One append is one write of whole lines. If a process is
killed mid-write, the last line of the last segment can be truncated; a
truncated line is skipped, counted once in `bufferDropped`, and logged once
per segment — the good lines before it are still replayed. On start-up,
before the broker is even connected, the store scans `INGEST_BUFFER_DIR` and
replays whatever an earlier process left, under the same two bounds — a host
restart during an outage loses nothing already on disk.

**But a host restarted while the database is still down does not start.** The
binding plan is read from the database before any supervisor exists
(`main.ts`, unchanged by `F1.10`), so the fresh process opens the store, logs
`disk buffer opened` with the segments it found, then exits 1 on
`ingest host failed to start` — measured 2026-09-06 in the step-6 drill:
`segments=1 buffered=26` scanned, then the exit; on the next start after the
database returned, the same 26 replayed in 9 s. The segments wait on the
volume; nothing is lost that the bounds would have kept. The compose `ingest`
service has no `restart:` policy, so that next start is an operator's
`docker compose up -d ingest`, not automatic — the same as before `F1.10`,
but it now also decides when the backlog lands.

**What an operator can look at directly.** Segment files are plain JSON lines
under the mounted volume, so they can be read without touching the API. In
compose (project name `bms`, so the volume is `bms_bms-ingest-buffer` and the
service container is `bms-ingest-1`):

```bash
docker compose --profile phe exec ingest ls -la /var/lib/bms-ingest/mqtt/
docker compose --profile phe exec ingest sh -c 'wc -l /var/lib/bms-ingest/mqtt/*/*.jsonl'
docker volume inspect bms_bms-ingest-buffer
```

**Segment files hold telemetry values.** They are plant data, the same
readings that land in `telemetry.point_values` — copying one off the host
moves that data off the host, and the usual handling rules for production
telemetry apply to it exactly as they would to a database export.

**What an operator will see in the logs**, all JSON lines on stdout, none of
them carrying a sample value or a credential:

- The store, on open: `info` with `{ dir, endpoints, segments, buffered,
  dropped, bytes }` — the recovered state before anything else runs.
- The store, on each bound erasure: `warn`, naming the segment.
- The store, at start-up, on a file it skipped — oversized or unreadable:
  `warn` with the path, and for an oversized one its size and the bound.
- The store, on a failed unlink, read, or append: `error`. On the third failed
  read of one segment, `error` "disk buffer segment unreadable; erased".
- The supervisor, on an oldest segment it could not read: `warn` "oldest
  segment unreadable; retrying after backoff" with `{ delayMs, attempt }`.
- The supervisor, on the write that triggers a spill: `error` "sample batch
  write failed; spilling to disk".
- The supervisor, on a failed replay probe: `warn` "replay write failed;
  probing after backoff" with `{ delayMs, attempt, buffered }`.
- The supervisor, on the first write after an outage: `info` "database write
  path recovered; replaying backlog".

## The uplink receiver

`E7.2`, ADR 0123 decisions 4–6, 8, 10 and 11; plan
`docs/plans/e7.2-edge-store-and-forward.md` PR 3. A site edge gateway posts
the samples it collected to this host, which writes them through the same
`resolveSamples` → `writeResolved` path the supervisor uses. **Off unless
`INGEST_UPLINK_PORT` is set.** The public route is the AWS demo nginx's
`location /edge/` over the compose network `edge-uplink` (ADR 0016 Amendment 9
(b)); set `INGEST_UPLINK_PORT=9103` to match it; health binds `127.0.0.1`.

**One route, checked in this order** (`src/host/uplink-server.ts`):

| Check | Refusal |
| --- | --- |
| path is exactly `/edge/v1/batches` | `404 {"error":"not-found"}` |
| method is `POST` | `405`, `Allow: POST` |
| one `Authorization: Bearer <token>`, **before the body is read** | `401 unauthorized` (`WWW-Authenticate: Bearer`), `403 gateway-revoked`, `403 ingest-disabled` |
| no other batch in flight for this gateway; its sample bucket not already empty | `429 busy`, `Retry-After: 5`; `429 rate-limited` |
| `Content-Encoding: gzip`; declared `Content-Length` ≤ 262 144 | `400 bad-encoding`, `413 too-large` |
| streamed body ≤ 262 144 bytes, decoded ≤ 1 048 576 (the inflater is destroyed at the cap) | `413 too-large`, `400 bad-gzip` |
| strict UTF-8 JSON, then `uplinkBatchSchema` (`@bms/shared/ingest`) | `400 bad-json`, `400 bad-schema` |
| the gateway's sample bucket (`INGEST_UPLINK_MAX_SAMPLES_PER_S`, one second's worth, refilling; a batch costs at least 50) | `429 rate-limited`, `Retry-After: <s>` |
| one of 4 write slots across all gateways, taken after the upload (the pool's default `max` is 10) | `429 overloaded`, `Retry-After: 5` |
| the write commits within 15 s | `503 write-failed`, `Retry-After: 30` |

A `200` carries `{ accepted, rejected: { foreignDevice, futureRx, tooOld,
unresolved } }` and is sent only after the rows and the gateway's report have
committed. **The units differ:** `accepted` is rows written (one sample that
fans out to two points is 2; two samples collapsed onto one key are 1);
`foreignDevice`, `futureRx` and `tooOld` are samples; `unresolved` is refused
writes as `droppedCount` sums them, so a sample refused for two of its targets
counts 2. Every refusal body is that fixed one-key JSON; no response and no
log line carries the body, a parse error, the header or the token
(AGENTS.md §9.6), and a database failure is logged by its class and SQLSTATE
code, never its message. Refusals are logged as one `warn` "uplink requests
refused" summary of counts at most once a minute, so a scanner cannot flood
the log; counts still held are flushed by a timer each minute and once at
shutdown. **Per-source limiting of unauthenticated requests is not here** —
the receiver knows a gateway, not a client address — it is nginx's `limit_req`
per client (right-most X-Forwarded-For), dry-run until confirmed: `docs/edge-gateway.md`.

**The write is bounded on the server:** the transaction opens with `SET LOCAL
statement_timeout = '14s'` and `lock_timeout = '5s'`, so Postgres cancels a
stalled statement itself; destroying the client alone would leave the backend
running it. A write still over 15 s is answered `503` and its `pg` client
destroyed, not pooled (the edge aborts at 20 s). **Shutdown cannot hang on a client:**
`close()` stops accepting, sends `Connection: close` on every later reply, and
after 2 s destroys every socket still open; `main.ts` waits at most 5 s.

**Authentication** (`src/host/uplink-gateways.ts`, ruling P5 (a)). No
database work happens before it: the host loads `bms.edge_gateways` (every
row, revoked ones included, with the organization's `ingest_enabled` and the
active RTU count) into memory at start and on every `INGEST_RELOAD_MS` tick,
beside the binding plan. The presented token is hashed with SHA-256 and
compared with `timingSafeEqual` against every row that holds a hash, with no
early exit; the stored hash is never itself a credential.
`tests/e7.2-uplink-auth-static.test.ts` holds the constant-time rule on the
source. **Revoke and rotate take effect within one reload (60 s by
default)**, and at commit even before it: the report's `UPDATE` matches only
an active row whose `token_hash` is the digest this request authenticated with
and whose organization has `ingest_enabled`, and an unmatched one rolls the
whole batch back (`503`, then `401`/`403` after the reload). A failing gateway
query on a reload is logged ("gateway snapshot reload failed") and keeps the
previous snapshot; it never stops the binding reload, and a failing binding
reload never stops the snapshot refreshing.

**Screening** (`src/host/uplink-receiver.ts`), each counted and none refusing
the batch, so one bad sample cannot block a gateway's queue:

- `foreignDevice` — the `deviceKey` is not the `rtu_code` of an RTU assigned
  to this gateway. Dropped, never resolved. A box deployed before its RTUs are
  assigned has **every** sample counted here and answered `200`, and the edge
  deletes them (ruling P10 (a)): **assign the RTUs before the box goes live.**
- `futureRx` — `rx` more than 60 s ahead of this host's clock.
- `tooOld` — `rx` more than 6 d 12 h old.
- `unresolved` — `resolveSamples`'s own drops (unmapped key, bad quality,
  non-finite, out of range), as `droppedCount` sums them.

`rx` becomes the row's `time` unchanged (ADR 0061 Amendment 4), so a retried
batch writes the same rows. Rows older than the live window are written and
not notified, as every ingest write is (ADR 0016 Amendment 9).

**The gateway report and the dirty window** (`src/host/uplink-write.ts`).
In the same transaction as the upsert, through `writeResolved`'s
`beforeCommit` hook, the gateway's `last_seen_at`, `reported_backlog` (the
wire's `buffered`, clamped to `integer`) and `clock_state` are set, and any
row more than 2 h old widens `backfill_dirty_from` / `backfill_dirty_to` with
`LEAST` / `GREATEST`. 2 h is one hour inside the `_1m` refresh policy's 3 h
(migration `0027`; `tests/e7.2-uplink-dirty-window-static.test.ts` scans every
migration for a later change to that policy). Every batch carrying a late row
also bumps `backfill_dirty_seq` (migration `0143`), even when its rows fall
inside the window and move neither bound, so the repair's compare-and-clear
never clears a generation it did not refresh. A batch whose every sample was
screened out still records the gateway.

**Aggregate repair runs with the receiver.** The repair pass
(`src/host/aggregate-repair.ts`) lists the dirty windows that are due (at
most once a minute per gateway), merges those that overlap or lie within an
hour of each other into one range (`REPAIR_MERGE_GAP_MS`, security review
L3), refreshes each range once with `@bms/db`'s `refreshAggregatesFrom`, and
then clears each window on its own compare-and-clear on the stored bounds and
generation — so a window that moved during the refresh is kept while the
others clear. Many sites returning from one outage therefore cost one refresh,
not one per gateway. `main.ts` starts it on a 10 s tick whenever `INGEST_UPLINK_PORT`
is set, and clears the timer on shutdown; with no listener there is nothing to
repair, so it does not start. A failed refresh is one `warn` line per range
("aggregate repair failed; window kept", with `gatewayIds`) and every window
in it waits for the next pass; a repaired one is one `info` line ("aggregate window repaired"). A
`55P03` retry inside `refreshAggregatesFrom` also writes its own plain-text
`[F4.1] … retrying` line to stderr, outside the JSON logger. The
host's role (`bms_fleet` in compose) refreshes through `SET ROLE bms_rollup`,
as the API does. `apps/ingest` depends on `@bms/db` since #1241, and its
Dockerfile builds it. Windows recorded before the wiring are columns, so the
first pass after a deploy repairs them. `aggregate-repair.integration.spec.ts`
holds the case: a batch 6 h late reaches `_1m` and `_1h` after one pass and
its window clears.

**Known limits** (security review L4; L3, one refresh per window, is fixed
by the merge above):

- **A token can overwrite its own history.** A valid token may post any value
  for its own gateway's points with an `rx` up to 6 d 12 h old, and the upsert
  replaces what was stored at that key, with no audit trail of the overwrite.
  The token cannot reach another gateway's RTUs (`foreignDevice`), and a
  revoke or rotation stops it at once, because every commit re-checks status
  and token hash. An audit of late overwrites is owed.
- **The device binding is read from memory.** Which RTUs a gateway may write
  comes from the binding plan of the last reload, so for up to one
  `INGEST_RELOAD_MS` tick a gateway can still write an RTU just reassigned.

**Health.** The body gains one line per gateway, after every other line:

```
gateway id=<uuid> code=<code> org=<org code> status=active|revoked ingest=on|off rtus=<n> lastSeen=<iso>|never backlog=<n>|unknown clock=synced|unsynced|unknown dirty=<from>..<to>|none
revoked-gateway id=<uuid> code=<code> rtus=<n> note=assigned-rtus-are-silent
```

The second appears only for a revoked gateway that still has active RTUs
assigned: the cloud dials none of them (decision 6) and the box is refused,
so those RTUs are silent until they are unassigned. **Neither line changes
the `ok`/`degraded` verdict** — a site's uplink is the site's state, and the
edge keeps its backlog on its own disk. The values are as of the last reload.

**Logs** (counts and ids, never values or messages): `warn` "uplink samples
rejected" (once a minute per gateway, counts summed); `info` "uplink rows
written outside the live window, not notified"; `error` "uplink batch write
failed", "uplink listener error", "gateway snapshot reload failed" (each with
`kind` and `code`); the refusal summary; `uplinkPort` on `ingest host started`.
**Probe:** `UPLINK_PROBE_TOKEN=bmsgw_… node apps/ingest/scripts/uplink-probe.mjs
--device <rtu_code> [--age 4h] [--count N] [--at <iso>]` posts one gzip batch;
the token comes from the environment, is never printed, and `--url` must be
`https:` unless loopback.

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
  days. **Commit 4 deleted it on 2026-08-14**, which is why realtime now has
  no switch rather than one compose line deep (every live row is notified;
  ADR 0016 Amendment 9 keys that on the row's time).
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
| A missing `ts` | Leaves `at` unset; `time` is the receive time either way and `device_time` is NULL (ADR 0061) | Fabricates `Date.now()` |

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

- **A connection-config or credential change on a running endpoint whose
  device set is unchanged still needs a restart** (ADR 0115 decision 6, plan
  R5). Enabling, disabling, adding or removing an RTU — and the organization
  switch — no longer do: the reload starts, replaces or stops the endpoint (see
  *Reloads*). But an edit that leaves the endpoint key and its device set as
  they were — a new password, a timeout — is a point-index swap: the running
  supervisor keeps the config and credentials it was built with until the host
  restarts. Detecting it would mean fingerprinting the decrypted credentials
  (AGENTS.md §9.6). A change that moves the endpoint key (a new host or port)
  is a stop of the old key and a start of the new one, so it applies.
- **~~A device's clock is trusted without check.~~ Closed by `F4.57`
  (ADR 0061).** A device timestamp no longer reaches the row's `time`. The host
  stamps its own **receive** time on every row and stores what the device
  claimed beside it, unclamped, in `telemetry.point_values.device_time` — the
  "recording both" option, chosen by the owner over trusting the device or
  clamping to receipt.

  The skew that motivated it, for anyone reading `device_time`: **~34 minutes
  ahead** on the pilot RTU on 2026-08-06, and a **3 h 37 m spread** across nine
  RTUs when `F1.7` measured the fleet on 2026-08-22, from −3:02:36 to +34:31.
  Not a timezone error — IST would be +5:30 — and stable per device rather than
  drifting.

  **Two things this did not fix.** Rows written before migration `0069` keep
  the device's clock in `time` and carry `device_time IS NULL`; nothing marks
  that boundary but the migration's own timestamp, and ruling 2 accepted it
  rather than rewrite 10 million rows. And the clocks themselves are still
  wrong — `device_time` makes the skew *visible and measurable*, it does not
  correct the devices.
- **RTUs sharing an endpoint share credentials.** The first non-empty set wins.
  This narrows the `activeMqttConnection` singleton in `index.js` but does not
  cure it; `F1.7` owns the per-RTU credential story (ADR 0016 §Consequences).
- **A batch whose disk append also fails is still gone**, counted in
  `bufferDropped` rather than replayed — `F1.10` buffers a write failure, it
  does not make one impossible. Beyond that, four things are still lost: a
  sample beyond either bound (`INGEST_BUFFER_MAX_AGE_MS`,
  `INGEST_BUFFER_MAX_BYTES`); the broker-outage window, where nothing reaches
  the host to buffer in the first place — that is `E7.2`, not this; and the
  segments of an endpoint that stays out of the plan longer than the bounds.
  A stopped endpoint's segments are **kept**, named on the health body as
  `stopped … buffered=<n>`, and replay when a supervisor for the same
  `(protocol, endpointKey)` next starts — at a re-enable or a host restart
  (ADR 0115 decision 7). Until then the reload tick's sweep applies both bounds
  to them as to any other, so an organization switched off for longer than
  `INGEST_BUFFER_MAX_AGE_MS` (1 h) loses what was buffered *before* the
  switch-off. Readings a device publishes *while* its organization is off are
  never received and cannot be recovered here.
- **On a shared broker, switching one organization off discards that
  organization's buffered samples** (ADR 0115 Amendment 1, owner ruling,
  2026-11-07 — documented, not changed). When the broker also serves another
  organization's RTUs, the switch-off is a `replace`, not a `stop`: the
  endpoint key stays in the plan. The new supervisor uses the same
  disk-buffer handle and replays the old segments against the **new** point
  index, which no longer holds the switched-off organization's RTUs. Their
  samples resolve as `unknownDevice` (counted on the `samples discarded`
  line), the segment is committed as replayed and deleted, and those samples
  are gone — even if the organization is switched back on within the hour.
  Only a broker whose RTUs all belong to the switched-off organization is a
  `stop`, which keeps its segments (above). The backlog exists only when the
  database was failing writes at the moment of the switch-off. The in-memory queue is
  still bounded at 10 000 samples and still drops oldest, but only until the
  first failed write spills it to disk — see *The disk buffer* above.
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

### Plain MQTT (ADR 0114, `F4.326`)

Every broker connection is TLS (`mqtts://`) unless **both** hold:

1. the RTU's stored `rtu_connection_configs.config` has the literal
   `tls: false` (absent, `true` or the string `"false"` all mean TLS — the
   string fails the schema as `invalid-connection-config`), and
2. the host the connection will dial — the stored `host`, or the `MQTT_HOST`
   fallback — is on `MQTT_PLAINTEXT_HOSTS`.

`tls: false` on an unlisted host is skipped as `plaintext-host-not-allowed`. It
is **never** connected with TLS instead: a silent TLS connect to a plain-only
broker is the failure ADR 0114 removes. The check is the host's
(`src/host/bindings.ts`); the adapter only builds what the validated config
says.

A plain endpoint:

- connects `mqtt://host:port` and passes no `rejectUnauthorized`;
- sends **only the credentials from the RTU's own encrypted blob** when the row
  names its own host. `MQTT_USERNAME`/`MQTT_PASSWORD` belong to the
  `MQTT_HOST` broker and are used only when that fallback host is the one
  dialled — never sent in clear text to another broker;
- logs one `warn` per adapter instance (so once per host start or endpoint
  restart): `mqtt endpoint is plaintext host=<host> port=<port>` — never the
  username, the password or a payload (AGENTS.md §9.6);
- is keyed `mqtt://host:port` on the health page and in the disk buffer
  (`key=mqtt://shapoorji.thinkiot.co.in:1883`, percent-encoded as the buffer
  directory name). A TLS endpoint keeps `host:port`, so the existing fleet's
  keys and spilled segments do not move, and a TLS and a plain RTU on one
  host never share a connection. A stored host carrying `/` (such as
  `mqtt://…`) is skipped as `invalid-connection-config`, and a row whose host,
  port or TLS choice differs from the endpoint it would join is skipped as
  `endpoint-config-conflict`, so no key collision can move an RTU onto a
  connection its row did not ask for.

**What it costs.** On a plain endpoint the decrypted broker username and
password, and every reading, cross the network in clear text. The list limits
that to hosts an operator named; the operator owns the list, never an
organization admin (who can write `config.tls` through the onboarding commit).

- **The health endpoint cannot tell an empty reading from a missing one**
  (`F4.58`). `dark rtu=… key=…` says a bound point stopped producing a
  reading; it cannot say whether the register answered empty (`null`, `""`,
  non-numeric — a field fault) or was never in the payload at all (a mapping
  fault) — the host that renders health never sees the payload, only the
  samples the adapter emitted. That distinction lives only in the adapter's
  `readings absent` log line (`empty=` / `missing=`, above).
- **A point mapped after boot is not tracked until its endpoint is rebuilt**
  (`F4.58`). `pointsByDevice` is built once, from `plan.bindings` at
  `createSupervisor` construction, and a mapping change on an unchanged device
  set is a point-index swap that does not rebuild it (see *Reloads*). A
  `source_data_key` added to an already-running RTU has no liveness entry, so
  it neither appears in `dark` nor moves the `dark=` count, however long it
  stays silent, until a host restart — or a reload that replaces that endpoint
  because its device set changed — rebuilds the bindings.
- **A `source_data_key` unmapped after boot has the reverse gap, and is not
  silent.** The MQTT adapter's own `bindingByDevice.sourceKeys` is built once,
  in `connect()`, from the plan's bindings at that time; a point-index swap
  never calls `connect()` again, so the key stays in the adapter's bound set
  until the endpoint is replaced or the host restarts. The RTU is
  still emitting it, so the adapter still routes the sample through and it
  still reaches `accept()`, which stamps `pointsByDevice` from the same
  original bindings — so the point never reads `dark`. What actually changes on
  a swap is the point index the registry hands the supervisor's write path each
  cycle: `resolveSamples` no longer finds the key there, counts it in
  `unmappedSourceKey`, and the row is discarded rather than written — logged on
  the `samples discarded` line, not silent.
- **A push adapter that emits only on change would read every unchanged point
  as dark.** ThinkIoT is not that adapter: it republishes every mapped key on
  every cycle whether or not the value moved, so `dark` genuinely means "this
  register stopped answering," not "this reading has not changed lately." A
  future adapter that only pushes deltas — the OPC-UA adapter `F1.4` is
  expected to add — would make a perfectly healthy, unchanging point look dark
  after one `INGEST_STALE_AFTER_MS` window, and that adapter's design has to
  reckon with it: either publish a periodic keep-alive sample per bound point,
  or `dark` on that protocol needs a different signal than last-sample-time.
