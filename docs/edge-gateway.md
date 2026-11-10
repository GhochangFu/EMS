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
cp .env.example .env                       # token, uplink origin, EDGE_CRED_* values
cp edge-config.example.json edge-config.json
docker compose up -d --build
docker compose exec edge wget -qO- http://127.0.0.1:9103/
```

`deploy/edge/docker-compose.yml` is its own file, not a profile of the root
compose file (plan C14). It runs `command: ["node", "dist/edge-main.js"]`,
keeps the buffer on the named volume `edge-buffer` at `/var/lib/bms-edge`,
mounts the config read-only, publishes no port and sets no `DATABASE_URL`.

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
database failure is on the cloud.

| Answer | What the edge does |
| --- | --- |
| `200` | Done. The body's counts are added to the health line in their own units (`accepted` is rows, the rejections are samples). |
| `400`, `413`, `422` | The batch can never be accepted: counted `uplinkRefused`, logged, **dropped**, so one poison batch cannot hold the queue (plan M4). |
| `401`, `403` | Kept on disk and retried — a token being rotated or an organization switched off must not delete data. |
| `429`, `503` | Kept and retried; `Retry-After` (capped at 5 min) is a not-before time. |
| network error, 20 s timeout, any other status | Kept and retried. |

One post is in flight at a time (the receiver answers `429` to a second), a
waiting live batch ahead of a waiting backlog one. A batch is `backlog` when
its oldest sample is more than 10 s old on the edge clock. A body over
256 KiB compressed is split. Every batch carries `buffered` (samples on disk)
and `clock`, which the cloud stores on the gateway row. The edge supervisor's
write timeout is 90 s, above the throttle wait, the post-lock wait and two
20 s posts.

## The clock guard

`src/host/edge-clock.ts` (ADR 0123 decision 8). The edge persists a
high-water mark of the time it hands out to `clock-mark.json`, at most once a
minute and on shutdown. If the wall clock at start is behind the mark, the
edge stamps `rx` as mark plus monotonic elapsed time and reports
`clock=unsynced`; once the wall clock passes that estimate it returns to it
with no backward step. A wall clock that steps back while running is caught
the same way. An unreadable mark is a warning and counts as none.

## Health

The same body as the cloud host, plus one line:

```
edge clock=synced lastUplink=200 notBefore=none batchesSent=12 accepted=40 uplinkRefused=0 unattributed=0 foreignDevice=0 futureRx=0 tooOld=0 unresolved=0
```

`clock=unsynced` degrades the verdict. An outage shows on the endpoint line
as `buffered>0 writePath=buffering`, which degrades it too. The counters are
lifetime counters and never part of the verdict.

## What is not yet proved

The plan's §8 outage drill (a real TLS proxy, a real broker, a 20-minute
outage, a kill mid-replay, the clock and secret checks) needs the running
stack and PR 4's route, and has not been run. The in-process round trip
(`src/host/edge-roundtrip.spec.ts`) and its Postgres twin
(`edge-roundtrip.integration.spec.ts`) are the evidence so far.
