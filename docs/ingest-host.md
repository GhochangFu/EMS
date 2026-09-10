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
| `INGEST_BUFFER_DIR` | `/var/lib/bms-ingest` | Where a batch the database refused lands (`F1.10`, ADR 0016 Amendment 4 ruling 4). Blank or unset takes the default; compose mounts a named volume at that path. **Must be absolute** — a relative value would resolve against the container working directory, putting the buffer on the writable layer with the volume unused, which nothing downstream can detect. A directory that cannot be created, that fails a write-and-unlink probe, or whose listing fails refuses host start-up with the path in the error — there is no "no buffer" mode. |
| `INGEST_BUFFER_MAX_AGE_MS` | `3600000` | How long a spilled segment survives, by receipt minute, before the age bound erases it. Strictly older than the bound is erased; exactly the bound is kept. Ceiling `2^31-1`, the same timer limit `INGEST_RELOAD_MS` and `INGEST_STALE_AFTER_MS` share. |
| `INGEST_BUFFER_MAX_BYTES` | `268435456` | Total bytes the on-disk buffer may hold, host-wide across every endpoint, before the byte bound erases the oldest segment. Ceiling `2^40` (1 TiB) — a fact about a disk, not about integers. |

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
is deferred to `F3.16` (ADR 0016 Amendment 4 decision 11).

```
ingest-host degraded endpoints=1 rtus=3 stale=1 skipped=0 notify=on uptime=39s
endpoint protocol=mqtt key=phe.thinkiot.co.in:8883 state=connected writePath=ok rtus=861736076104923|861736076128245|861736076133666 restarts=1 pollFailures=0 queue=0 dropped=0 written=812 writeFailures=0 buffered=0 bufferDropped=0 replayed=0 lastSample=2026-08-22T09:41:07.000Z
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
- **The device list is fixed at start-up. Enabling or disabling an RTU needs a
  host restart.** The reload loop refreshes point mappings only; a supervisor's
  bindings are never replaced (see *Reloads* below). A newly enabled RTU is
  therefore absent from `rtus=`, absent from the `stale` accounting, and its
  messages are discarded — with no warning, because the endpoint key already
  existed. A newly *disabled* one keeps its place and eventually reports
  `stale`, degrading a host that is behaving correctly. This predates `F1.7`,
  but `F1.7` promotes that list from an enumeration into the input of the
  `ok`/`degraded` verdict, so the restart matters more than it did.
- `skipped` lines name every RTU left out and why (`no-adapter`,
  `unsupported-protocol`, `missing-rtu-code`, `invalid-connection-config`, …),
  so a gateway that never appears is visible without reading the log.
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

- **Reload refreshes point mappings only.** Mapping a new point onto an
  already-served RTU takes effect within `INGEST_RELOAD_MS`. Enabling a *new*
  RTU, or changing one's protocol or endpoint, needs a restart — the host logs
  `new endpoint requires a restart to serve` when it sees one. Reconciling the
  endpoint set is a second state machine on top of the supervisor's, and half
  of one is worse than none.
- **Enabling or disabling an RTU on an endpoint that is already running also
  needs a restart, and now says so.** A supervisor's `plan.bindings` is captured
  at construction and never replaced, so the reload swaps the point index and
  nothing else. Writes for a disabled RTU *do* stop within one cycle, because the
  refreshed index no longer holds its `deviceKey` — but the adapter stays
  subscribed, the health roster keeps listing it, and it keeps reading as not
  stale: three signals that disagree. Enabling one is worse, since it is absent
  from `rtus=`, absent from the stale accounting, and its messages are discarded.
  MQTT groups a whole broker into **one** endpoint, so the `new endpoint` warning
  above can never fire for this case. The reload therefore logs
  `endpoint device set changed; restart required to apply` with the added and
  removed device keys. That names the gap rather than closing it.
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
  segments of an endpoint no longer in the plan (an RTU or gateway removed
  between an outage and the reload) — nobody replays them, because a handle is
  keyed to a live endpoint, and they sit until the age bound erases them, the
  byte bound erases them to make room for another endpoint, or the next
  start-up scan finds them stale and does the same. The in-memory queue is
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
