# Ingest host — device health (`F3.16`, ADR 0127)

Split out of [`ingest-host.md`](./ingest-host.md), which sits at the 1000-line
mark. The two environment variables that belong to device health:

| Variable | Default | Meaning |
|---|---|---|
| `INGEST_HEALTH_FLUSH_MS` | `10000` | ADR 0127 decision 16 (`F3.16`). How often the device-health heartbeat and counters are flushed. `1000`–`15000`, so at least two beats land inside the API's 30 s host-stale bound; anything else refuses start-up naming the variable. |
| `INGEST_HOST_KEY` | `cloud` | ADR 0127 decision 10 (`F3.16`). This host's row in `bms.ingest_hosts`, and the `host_key` on the RTU rows it writes. Trimmed; `[a-z0-9-]{1,64}` or start-up is refused. Two hosts must not share a key. |

The host is the one writer of device health. Nothing here changes the health
endpoint below; it is a second, database-side record.

- **Attribution.** `resolveSamples` returns, beside `counters` (unchanged),
  per device: the newest receive time of any sample (written or dropped), the
  clock skew of the newest sample with a device time, and per drop reason the
  count and the first point dropped. `unknownDevice`, `ambiguousDevice` and a
  raw `nonFinite` from an unbound device have no RTU and are counted per
  endpoint instead. Device-supplied strings (source key, device key) are cut to
  128 characters and stripped of control characters before they are logged or
  stored. The `samples discarded` line carries `firstDropped`; the uplink's
  rejection line still carries counts only (ADR 0123).
- **Recorded after the write.** A batch is recorded only once its write has
  committed (or when it had no row to write): a failed write is spilled and
  replayed, and recording it first would count it twice. The uplink receiver
  records an edge gateway's RTUs the same way, under the endpoint key
  `edge:<gateway id>`. The host does not store "edge-served"; the API derives
  it from `rtus.edge_gateway_id`.
- **The flush.** Every `INGEST_HEALTH_FLUSH_MS`, one transaction
  (`device-health-write.ts`, `statement_timeout` 5 s, `lock_timeout` 2 s,
  `timezone` UTC so whole-hour buckets pass `0149`'s CHECK): the
  `bms.ingest_hosts` beat, the `monitored_since` changes, `bms.rtu_health`
  (last-seen only moves forward), and the hourly `bms.rtu_drop_hours` and
  `bms.ingest_endpoint_drop_hours` buckets (counts add; the first point is
  the stored one). Every tenant row is joined to `bms.rtus`, so the
  organization comes from the database and an RTU deleted since the plan
  loaded writes nothing. A failed flush is merged back into memory, keeping at
  most the last 24 hours of buckets, and logged as `device health flush
  failed`.
- **The heartbeat.** `started_at` is the process start; `healthy_since`
  restarts at boot and whenever more than two flush intervals pass with no
  committed beat. The API judges every RTU against `last_beat_at`, so a
  stopped host freezes RTU state rather than turning the fleet Offline.
- **Monitored.** At boot and on each reload the host stamps
  `monitored_since` on every RTU that entered its plan (cloud endpoints and
  edge gateways) and clears it on every RTU that left; the first flush after
  boot also clears this host's stamp on any RTU no longer in the plan. A
  shutdown runs one last flush after the supervisors stop.
