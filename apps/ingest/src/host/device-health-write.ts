import type { HealthFlush } from "./device-health.js";
import type { QueryableClient } from "./normaliser.js";

/**
 * The device-health flush (`F3.16`, ADR 0127 decisions 7, 9, 10 and 17).
 *
 * **One transaction**: the host's beat, the `monitored_since` changes, the RTU
 * rows and the hour buckets commit together or not at all. A beat that
 * committed without its counters would tell the API the host is healthy while
 * the drops it saw are lost; a failure rolls everything back and the caller
 * `restore`s the flush into the accumulator.
 *
 * The host connects as `bms_fleet` (BYPASSRLS). **It never supplies an
 * `organization_id`**: every tenant row is an `INSERT … SELECT` joined to
 * `bms.rtus`, so the organization comes from the database (decision 7), and an
 * RTU id `bms.rtus` does not hold — deleted since the plan was loaded — joins
 * to nothing and writes nothing instead of failing the flush. Parameterised
 * throughout (§4.4); arrays go through `unnest`, so one statement per table
 * whatever the batch size.
 */

/**
 * Server-side bounds, the `uplink-write.ts` pattern: Postgres cancels a
 * stalled flush itself rather than leaving a backend running after the host
 * has given up. Well under the 10 s flush interval.
 *
 * `timezone = 'UTC'` because migration `0149`'s CHECK is `bucket =
 * date_trunc('hour', bucket)`, which truncates in the **session** time zone: a
 * UTC whole hour is not a whole hour in a half-hour zone such as
 * `Asia/Kolkata`, and every bucket would be refused there.
 */
export const HEALTH_TRANSACTION_SETTINGS: readonly string[] = [
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL lock_timeout = '2s'",
  "SET LOCAL timezone = 'UTC'",
];

export const UPSERT_HOST = `
  INSERT INTO bms.ingest_hosts (host_key, started_at, healthy_since, last_beat_at, endpoints, updated_at)
  VALUES ($1, $2, $3, $4, $5, now())
  ON CONFLICT (host_key) DO UPDATE
     SET started_at = EXCLUDED.started_at,
         healthy_since = EXCLUDED.healthy_since,
         last_beat_at = EXCLUDED.last_beat_at,
         endpoints = EXCLUDED.endpoints,
         updated_at = now()
`;

/** The boot sweep: this host's stamps on RTUs outside its plan are cleared. */
export const CLEAR_OUTSIDE_PLAN = `
  UPDATE bms.rtu_health
     SET monitored_since = NULL, updated_at = now()
   WHERE host_key = $1
     AND monitored_since IS NOT NULL
     AND NOT (rtu_id = ANY($2::uuid[]))
`;

export const CLEAR_EXITED = `
  UPDATE bms.rtu_health
     SET monitored_since = NULL, updated_at = now()
   WHERE host_key = $1
     AND rtu_id = ANY($2::uuid[])
`;

/**
 * `COALESCE(old, new)`: an RTU already monitored keeps its stamp when the
 * host restarts and enters it again. One that left had its stamp cleared, so
 * a real re-entry is stamped afresh.
 */
export const STAMP_ENTERED = `
  INSERT INTO bms.rtu_health (rtu_id, organization_id, host_key, monitored_since, updated_at)
  SELECT r.id, r.organization_id, $1, e.since, now()
    FROM unnest($2::uuid[], $3::timestamptz[]) AS e(rtu_id, since)
    JOIN bms.rtus r ON r.id = e.rtu_id
  ON CONFLICT (rtu_id) DO UPDATE
     SET host_key = EXCLUDED.host_key,
         monitored_since = COALESCE(bms.rtu_health.monitored_since, EXCLUDED.monitored_since),
         updated_at = now()
`;

/**
 * Last-seen only moves forward (`GREATEST` ignores a `NULL`), so a replayed
 * batch cannot move it back (decision 9). The skew is replaced only by one
 * taken from a sample at least as new.
 */
export const UPSERT_ACTIVITY = `
  INSERT INTO bms.rtu_health
    (rtu_id, organization_id, host_key, last_seen_at, clock_skew_seconds, clock_skew_at, updated_at)
  SELECT r.id, r.organization_id, $1, a.last_seen_at, a.skew_seconds, a.skew_at, now()
    FROM unnest($2::uuid[], $3::timestamptz[], $4::integer[], $5::timestamptz[])
         AS a(rtu_id, last_seen_at, skew_seconds, skew_at)
    JOIN bms.rtus r ON r.id = a.rtu_id
  ON CONFLICT (rtu_id) DO UPDATE
     SET host_key = EXCLUDED.host_key,
         last_seen_at = GREATEST(bms.rtu_health.last_seen_at, EXCLUDED.last_seen_at),
         clock_skew_seconds = CASE
           WHEN EXCLUDED.clock_skew_at IS NOT NULL
            AND (bms.rtu_health.clock_skew_at IS NULL OR EXCLUDED.clock_skew_at >= bms.rtu_health.clock_skew_at)
           THEN EXCLUDED.clock_skew_seconds ELSE bms.rtu_health.clock_skew_seconds END,
         clock_skew_at = CASE
           WHEN EXCLUDED.clock_skew_at IS NOT NULL
            AND (bms.rtu_health.clock_skew_at IS NULL OR EXCLUDED.clock_skew_at >= bms.rtu_health.clock_skew_at)
           THEN EXCLUDED.clock_skew_at ELSE bms.rtu_health.clock_skew_at END,
         updated_at = now()
`;

/**
 * `dropped = old + new`; the first point is the stored one when there is one
 * (`COALESCE(old, new)` taken over the three columns together, so a raw
 * `nonFinite`'s source key is never paired with a later drop's point).
 */
export const UPSERT_RTU_DROPS = `
  INSERT INTO bms.rtu_drop_hours
    (organization_id, rtu_id, bucket, reason, dropped, first_asset_id, first_point_key, first_source_key)
  SELECT r.organization_id, r.id, d.bucket, d.reason, d.dropped, d.first_asset_id, d.first_point_key, d.first_source_key
    FROM unnest($1::uuid[], $2::timestamptz[], $3::text[], $4::bigint[], $5::uuid[], $6::text[], $7::text[])
         AS d(rtu_id, bucket, reason, dropped, first_asset_id, first_point_key, first_source_key)
    JOIN bms.rtus r ON r.id = d.rtu_id
  ON CONFLICT (rtu_id, bucket, reason) DO UPDATE
     SET dropped = bms.rtu_drop_hours.dropped + EXCLUDED.dropped,
         first_asset_id = CASE WHEN ${unnamed("bms.rtu_drop_hours")}
                               THEN EXCLUDED.first_asset_id ELSE bms.rtu_drop_hours.first_asset_id END,
         first_point_key = CASE WHEN ${unnamed("bms.rtu_drop_hours")}
                                THEN EXCLUDED.first_point_key ELSE bms.rtu_drop_hours.first_point_key END,
         first_source_key = CASE WHEN ${unnamed("bms.rtu_drop_hours")}
                                 THEN EXCLUDED.first_source_key ELSE bms.rtu_drop_hours.first_source_key END
`;

export const UPSERT_ENDPOINT_DROPS = `
  INSERT INTO bms.ingest_endpoint_drop_hours
    (host_key, endpoint_key, bucket, reason, dropped, first_device_key, first_source_key)
  SELECT $1, d.endpoint_key, d.bucket, d.reason, d.dropped, d.first_device_key, d.first_source_key
    FROM unnest($2::text[], $3::timestamptz[], $4::text[], $5::bigint[], $6::text[], $7::text[])
         AS d(endpoint_key, bucket, reason, dropped, first_device_key, first_source_key)
  ON CONFLICT (host_key, endpoint_key, bucket, reason) DO UPDATE
     SET dropped = bms.ingest_endpoint_drop_hours.dropped + EXCLUDED.dropped,
         first_device_key = CASE WHEN ${unnamedEndpoint()}
                                 THEN EXCLUDED.first_device_key ELSE bms.ingest_endpoint_drop_hours.first_device_key END,
         first_source_key = CASE WHEN ${unnamedEndpoint()}
                                 THEN EXCLUDED.first_source_key ELSE bms.ingest_endpoint_drop_hours.first_source_key END
`;

function unnamed(table: string): string {
  return `(${table}.first_asset_id IS NULL AND ${table}.first_point_key IS NULL AND ${table}.first_source_key IS NULL)`;
}

function unnamedEndpoint(): string {
  const t = "bms.ingest_endpoint_drop_hours";
  return `(${t}.first_device_key IS NULL AND ${t}.first_source_key IS NULL)`;
}

/** Writes one drained flush in one transaction; throws (after `ROLLBACK`) on any failure. */
export async function writeDeviceHealth(client: QueryableClient, flush: HealthFlush): Promise<void> {
  const { host, monitoring, rtus, drops, endpointDrops } = flush;
  await client.query("BEGIN");
  try {
    for (const setting of HEALTH_TRANSACTION_SETTINGS) {
      await client.query(setting);
    }
    await client.query(UPSERT_HOST, [host.hostKey, host.startedAt, host.healthySince, host.beatAt, host.endpoints]);
    if (monitoring.keep !== null) {
      await client.query(CLEAR_OUTSIDE_PLAN, [host.hostKey, monitoring.keep]);
    }
    if (monitoring.exited.length > 0) {
      await client.query(CLEAR_EXITED, [host.hostKey, monitoring.exited]);
    }
    if (monitoring.entered.length > 0) {
      await client.query(STAMP_ENTERED, [
        host.hostKey,
        monitoring.entered.map((e) => e.rtuId),
        monitoring.entered.map((e) => e.since),
      ]);
    }
    if (rtus.length > 0) {
      await client.query(UPSERT_ACTIVITY, [
        host.hostKey,
        rtus.map((r) => r.rtuId),
        rtus.map((r) => r.lastSeenAt),
        rtus.map((r) => r.clockSkewSeconds),
        rtus.map((r) => r.clockSkewAt),
      ]);
    }
    if (drops.length > 0) {
      await client.query(UPSERT_RTU_DROPS, [
        drops.map((d) => d.rtuId),
        drops.map((d) => d.bucket),
        drops.map((d) => d.reason),
        drops.map((d) => d.dropped),
        drops.map((d) => d.firstAssetId),
        drops.map((d) => d.firstPointKey),
        drops.map((d) => d.firstSourceKey),
      ]);
    }
    if (endpointDrops.length > 0) {
      await client.query(UPSERT_ENDPOINT_DROPS, [
        host.hostKey,
        endpointDrops.map((d) => d.endpointKey),
        endpointDrops.map((d) => d.bucket),
        endpointDrops.map((d) => d.reason),
        endpointDrops.map((d) => d.dropped),
        endpointDrops.map((d) => d.firstDeviceKey),
        endpointDrops.map((d) => d.firstSourceKey),
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
