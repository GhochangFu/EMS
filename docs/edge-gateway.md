# The edge gateway

Operator notes for the edge runtime of `E7.2`
(**[ADR 0123](./adr/0123-edge-store-and-forward.md)**, plan
[`docs/plans/e7.2-edge-store-and-forward.md`](./plans/e7.2-edge-store-and-forward.md)
PR 5). The cloud side — the receiver it posts to — is *The uplink receiver*
in [`ingest-host.md`](./ingest-host.md).

A site box runs the ingest image with its second entry point,
`node dist/edge-main.js`. It collects from local devices with the same
adapters, supervisor and `F1.10` disk buffer the cloud host uses, keeps
samples on disk while the uplink is down (72 h by default, 6 d at most), and
posts them over HTTPS to the cloud. Each sample keeps the receive time the
edge stamped (`rx`), so a retried batch writes the same row.

**What it does not do** (ADR 0123 decision 1): no database, no point mapping,
no alarms, no dashboard, no commands to devices. Samples leave un-normalised;
the cloud maps, scales and writes them. `tests/e7.2-edge-entry-point.test.ts`
holds that `edge-main.ts` reaches no `pg`, no `@bms/db` and none of the
cloud-only modules.

## Running it

```bash
cd deploy/edge
install -m 600 .env.example .env          # 0600 from the start: it holds the token and EDGE_CRED_* values
cp edge-config.example.json edge-config.json
docker compose up -d --build
docker compose exec edge wget -qO- http://127.0.0.1:9103/
```

`deploy/edge/docker-compose.yml` is its own file, not a profile of the root
compose file (plan C14). It runs `command: ["node", "dist/edge-main.js"]`,
keeps the buffer on the named volume `edge-buffer` at `/var/lib/bms-edge`,
mounts the config read-only, publishes no port, sets no `DATABASE_URL`, and
gives shutdown 30 s (`stop_grace_period`) to spill and write the clock mark.

**Owed to the owner:** a `start:edge` script (`node dist/edge-main.js`) in
`apps/ingest/package.json`, as the plan's T5.6 asks. An agent may not edit a
`package.json`, so until it is added the compose file runs the command
directly. `pnpm start` stays the cloud host.

**Before a box is switched on**, its RTUs must be assigned to its gateway on
the admin page (plan P10 (a)): until then the cloud answers `200` and counts
every sample `foreignDevice`, and the edge deletes them as delivered.

**The public route** (`location /edge/` in nginx, the `edge-uplink` network)
is `E7.2` PR 4. Until it is deployed the cloud answers nothing on
`/edge/v1/batches`, and the edge keeps everything on disk and retries.

### Box requirements

A battery-backed clock or NTP (see *The clock guard*), a writable volume for
the buffer, outbound HTTPS to the cloud origin, and the network path to the
site's broker. Hardware, OS image and remote access are out of scope
(ADR 0123 decision 13). The image is built for `amd64` in CI; an `arm64` box
needs a local build:

```bash
docker buildx build --platform linux/arm64 -f apps/ingest/Dockerfile -t bms-ingest:edge-arm64 .
```

## Environment

Read by `src/host/edge-config.ts`, the edge's one environment reader. Every
refusal exits 1 with `edge gateway failed to start` and names the variable or
the place in the file — **never the value**: not the token, not a URL that
might carry credentials, not a credential, not a config value.

| Variable | Default | Rule |
| --- | --- | --- |
| `EDGE_CONFIG_FILE` | required | Absolute path to the JSON file below. |
| `EDGE_UPLINK_URL` | required | An `https://` **origin**: no `http:`, no credentials, no path, query or fragment. There is no exception, not even loopback, and no switch to lower certificate verification. The client posts to `/edge/v1/batches` itself. A private CA is trusted with `NODE_EXTRA_CA_CERTS`. |
| `EDGE_GATEWAY_TOKEN` | required | `bmsgw_` and 43 characters, minted once on the admin page. Sent as `authorization: Bearer …`; never logged. |
| `EDGE_BUFFER_DIR` | `/var/lib/bms-edge` | Absolute. Segments live in `<dir>/segments`, the clock mark at `<dir>/clock-mark.json` (C10). Directories `0700`, files `0600`. |
| `EDGE_BUFFER_MAX_AGE_MS` | `259200000` (72 h) | Ceiling `518400000` (6 d), which keeps a backlog out of compressed chunks. |
| `EDGE_BUFFER_MAX_BYTES` | `1073741824` (1 GiB) | Both bounds drop oldest first and count it in `bufferDropped`. |
| `EDGE_REPLAY_MAX_SAMPLES_PER_S` | `500` | Floor `50`. Caps backlog batches only; live batches never wait. |
| `INGEST_HOST_HEALTH_PORT` | `9103` | The health listener, as on the cloud. |
| `INGEST_STALE_AFTER_MS` | `300000` | As on the cloud. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | unset | `0` refuses the start: the edge never lowers certificate verification. |
| `MQTT_PLAINTEXT_HOSTS` | empty | Plain MQTT (`"tls": false`) only to a broker host listed here (ADR 0114, plan P6). |
| `EDGE_CRED_<NAME>` | — | One per credential the config file names. |

No dotenv file is read: the environment is what compose passes.

## The configuration file

Schema: `edgeConfigFileSchema` in `packages/shared/src/ingest-edge-config.ts`,
then each adapter's own `configSchema` and `deviceSchema`. Strict: a
misspelt key is refused by name. The shipped example is
`deploy/edge/edge-config.example.json` (a spec checks it parses).

```json
{
  "endpoints": [
    {
      "protocol": "mqtt",
      "config": { "host": "broker.site.local", "port": 8883 },
      "credentials": { "username": "EDGE_CRED_SITE_BROKER_USER", "password": "EDGE_CRED_SITE_BROKER_PASSWORD" },
      "devices": [
        { "deviceKey": "SITE-RTU-01", "device": { "topic": "site/rtu-01/data" }, "sourceKeys": ["kw", "kwh"] }
      ]
    }
  ]
}
```

- `deviceKey` is the RTU's `rtu_code` in the cloud; each appears once.
- `credentials` maps a key the adapter reads to an **environment variable
  name** matching `^EDGE_CRED_[A-Z0-9_]+$`. A value that is not such a name
  — a password pasted into the file — refuses the start. A variable that is
  not set is named.
- `rejectUnauthorized` is refused, whatever its value.
- MQTT: `sourceKeys` is **required** per device, because the adapter emits
  only the listed keys. A payload format other than the built-in envelope is
  written inline on the device (`"device": { "topic": …, "payloadFormat":
  { "code": …, "definition": … } }`); an endpoint-level `payloadFormat` code
  is refused, because there is no catalog on the box.
- Two endpoints that resolve to one adapter endpoint key (one broker) are
  refused: list their devices under one.

## The uplink

`src/host/uplink-client.ts` is the supervisor's `writeSamples`: a resolve is
done, a reject is a spill to disk and a probe on the §5 backoff, exactly as a
database failure is on the cloud. The rule is that **only the receiver,
refusing the content, can make the edge drop a batch** (ADR 0123 Amendment 2).

| Answer | What the edge does |
| --- | --- |
| `200` with a body that passes `uplinkResponseSchema` | Delivered, whatever its reject counts (ruling Q7a). The counts are added to the health line in their own units (`accepted` is rows, the rejections are samples). If any sample was rejected `futureRx` or `tooOld`, health is `degraded` for ten minutes and one line a minute says so. |
| `200` with any other body (a proxy or captive-portal page) | Kept and retried. |
| `400` whose body is `{ "error": "bad-schema" }` | The batch can never be accepted: counted `uplinkRefused`, logged, **dropped**, so one poison batch cannot hold the queue (plan M4). Every sample is pre-checked against the same schema, so this means the two ends disagree on the version. Health is `degraded` for ten minutes. |
| `400` `bad-encoding`/`bad-gzip`/`bad-json`, `413` `too-large` (the receiver's transport refusals, `UPLINK_REFUSAL_STATUS` in `@bms/shared/ingest`) | Kept and retried — a middlebox rewriting the body must not drain the backlog. Health is `degraded` for ten minutes. |
| `400`/`413` with any other body, `422` | Kept and retried — a proxy's error page is not the receiver refusing the data. |
| `401`, `403` | Kept and retried — a token being rotated or an organization switched off must not delete data. |
| `429`, `503` | Kept and retried; `Retry-After` (capped at 5 min) is a not-before time. |
| network error, 20 s timeout, a response body over 64 KiB, any other status | Kept and retried. |

Before a batch is encoded, each sample is checked against the wire schema: a
device time that does not fit is left off (the cloud uses `rx`;
`deviceTimeDropped`), and a sample that still does not fit is dropped alone
(`invalid`). One bad sample never sinks its batch.

**One post at a time, gateway-wide.** The receiver answers `429` to a second
batch in flight for one gateway, so every endpoint of the box shares one
post slot (a waiting live batch goes before a waiting backlog one), and a
`429` or `503` with `Retry-After` defers **every** endpoint of the gateway,
not only the one that was answered. That is the box's throughput ceiling: one
batch of up to 500 samples per round trip.

A batch is `backlog` when its oldest sample is more than 10 s old on the edge
clock; backlog batches wait on a schedule at `EDGE_REPLAY_MAX_SAMPLES_PER_S`.
The schedule runs on the monotonic clock, so a clock resync cannot freeze
replay. A wait past ≈50 s (the write timeout less the lock wait and one post)
is refused at once without reserving, and a batch that never posts gives its
share back: five endpoints replaying full batches at the 50/s floor all fit.
A refused wait is a failed replay write, so that endpoint's breaker opens and
its live batches spill until the next probe succeeds — delayed, not lost. No post starts that could finish after the supervisor's 90 s write
timeout. A body over 500 samples or 256 KiB compressed is split; if any half fails, the whole
batch is retried at the same `rx`. Every batch carries `buffered` (samples on
disk) and `clock`. On shutdown the client refuses new posts and aborts the
one in flight, so the batches are spilled, not lost.

## The clock guard

`src/host/edge-clock.ts` (ADR 0123 decision 8 and Amendment 2). The edge
persists a high-water mark of the time it hands out to `clock-mark.json`
(written to a unique temp file, `fsync`ed, renamed; at most once a minute,
and on shutdown with `"clean": true`).

- **At start**, if the wall clock is behind the mark — plus 75 s (one persist
  interval and one tick) unless the mark is from a clean shutdown, so a crash
  can never re-issue an `rx` already sent (a clean mark is replaced by an
  unclean one as soon as it is read) — the edge stamps `rx` as mark plus
  monotonic elapsed time and reports `clock=unsynced`. Order is kept across a
  reboot with a reset clock.
- **`unsynced` ends** when the wall clock reaches that estimate, or at the
  first `200` with a schema-valid body whose `Date` header is within 30 s of
  the wall clock: the cloud says the wall clock is right and the mark was
  wrong. The edge returns to the wall clock and resets the mark — the one case
  `rx` steps backwards, logged at `warn` whenever the step is over a second.
- A wall clock that steps back while running goes `unsynced` the same way, and
  returns at the next trusted response.
- **While `synced`**, a trusted cloud time more than 60 s from the wall clock
  shows `clock=skewed` on the health line (degraded). `rx` is never shifted by
  the offset (ADR 0123 Q7a: the cloud rejects and counts instead).
- A mark that is not a time within a four-digit year is a warning and counts
  as none.

**Manual reset:** stop the box, delete `clock-mark.json` from the buffer
volume (`docker compose run --rm --entrypoint rm edge /var/lib/bms-edge/clock-mark.json`),
start it. The segments are not touched.

## Health

The same body as the cloud host, with `notify=cloud` in the header (the edge
notifies nothing; the cloud does), plus one line:

```
edge clock=synced lastUplink=200 notBefore=none lastRefused=never batchesSent=12 accepted=40 uplinkRefused=0 unattributed=0 invalid=0 deviceTimeDropped=0 foreignDevice=0 futureRx=0 tooOld=0 unresolved=0
```

`clock=unsynced`, `clock=skewed` and a batch refused in the last ten minutes
degrade the verdict. An outage shows on the endpoint line as `buffered>0
writePath=buffering`, which degrades it too. The counters are lifetime
counters and never part of the verdict.

## Known limits

- The container runs as root (the ingest image's default). Owed as a
  follow-up backlog row: a non-root user that owns the buffer volume.
- Throughput is one post at a time per gateway (see *The uplink*).
- A box whose RTC is more than 60 s ahead, with the cloud reachable, shows
  `clock=skewed` (degraded) and **its samples are rejected by the cloud
  (`futureRx`) until the clock is fixed** — ruling Q7a working as ruled. A
  box whose *mark* is ahead loses at most the batches before its first good
  reply, which resyncs it.
- The trusted-`Date` rule trusts what arrives over the verified TLS
  connection; a TLS-inspecting proxy at the site that stamps `Date` from the
  same wrong clock would make a wrong wall clock look right.
- Not built, for the owner to rule on: while `skewed`, stamp `rx` from the
  last trusted cloud time plus monotonic elapsed time.

## What is not yet proved

The plan's §8 outage drill (a real TLS proxy, a real broker, a 20-minute
outage, a kill mid-replay, the clock and secret checks) needs the running
stack and PR 4's route, and has not been run. The in-process round trip
(`src/host/edge-roundtrip.spec.ts`) and its Postgres twin
(`edge-roundtrip.integration.spec.ts`) are the evidence so far.
