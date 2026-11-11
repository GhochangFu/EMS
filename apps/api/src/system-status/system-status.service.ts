import { Inject, Injectable } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { SystemComponent, SystemStatusResponse } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";
import { QueueHealthService } from "../queue/queue-health.service";
import { StorageHealthService } from "../storage/storage-health.service";
import { readIngestHosts } from "../device-health/device-health.reads";
import { hostSummaryFor, rtuStateAt, type HostBeat } from "../device-health/device-state";
import { FRESHNESS_FLOOR_SECONDS, liveAssetsCteSql, rtuWindowsCteSql } from "../telemetry/telemetry-cadence";
import {
  dataQualityPercent,
  fieldDataState,
  queueComponentState,
  storageComponentState,
  verdict,
} from "./system-status";

interface StatusCountsRow extends Record<string, unknown> {
  streaming_assets: number;
  fresh_assets: number;
  mqtt_assets: number;
  mqtt_fresh: number;
}

const EMPTY_COUNTS: StatusCountsRow = {
  streaming_assets: 0,
  fresh_assets: 0,
  mqtt_assets: 0,
  mqtt_fresh: 0,
};

/** A monitored RTU serving an asset in scope (`F3.16`): its `rtu_health` fields and its window. */
interface MonitoredRtuRow extends Record<string, unknown> {
  host_key: string | null;
  last_seen_ms: number | null;
  monitored_since_ms: number;
  window_seconds: number;
}

interface ScopedRead {
  readonly counts: StatusCountsRow;
  readonly monitored: readonly MonitoredRtuRow[];
}

const EMPTY_READ: ScopedRead = { counts: EMPTY_COUNTS, monitored: [] };

/**
 * `F3.30` (ADR 0075 decisions 1, 3, 4) — the body of `GET
 * /api/v1/system/status`: three component states, one verdict, and the
 * data-quality figure for the caller's scope.
 *
 * **Components.** `queue` and `storage` are platform state, the same for every
 * caller (ADR 0075 ruled here 6), read from the providers `GET /health` uses.
 * Only the state crosses into the body — never a depth, bucket name,
 * heartbeat time or error text (decision 4). `field_data` is `not_monitored`
 * when the caller has no asset on an `mqtt` RTU (ruled here 5); otherwise,
 * since `F3.16` (ADR 0127 decision 21), the ingest host's heartbeat decides:
 * `ok` fresh, `degraded` stale or absent. The hosts judged are those serving
 * the caller's monitored RTUs, or every host when none is served yet
 * (`hostSummaryFor`). Silent devices no longer degrade it. There
 * is no `database` component: a database outage fails this request before any
 * component could report it, and the web renders that failure as the red
 * state.
 *
 * **The query.** `scoped` is every asset in scope with an RTU (the streaming
 * denominator, decision 1 — no `active` filter, plan decision 1);
 * `live` is the any-point CTE `liveAssetsCteSql` (`telemetry-cadence.ts`,
 * `F4.350`, ADR 0075 Amendment 3), narrowed to `scoped`: each asset is fresh
 * inside its own RTU's window, `clamp(2.5 x interval, 25 s, 900 s)` — never a
 * restated number and never a bound parameter, which would plan every
 * `point_values` chunk. The one rule drives both `dataQuality` and
 * `field_data`; `windowSeconds` reports the 25 s floor, the smallest window
 * any asset has. The fixed 150 s reporting window of Amendments 1-2 is gone.
 * `tests/f3.28-offline-bound-single-source.test.ts` pins this file to the
 * shared CTE. The SQL is unaliased so
 * Drizzle's `inArray(assets.id, …)` renders against `bms.assets`.
 *
 * **Scope.** `assetIds` is `readableAssetIds(user)` (`null` = unrestricted),
 * routed through `withReadScope`, and every read inside `fn` uses its `tx`.
 * A single-organization caller runs inside `withTenant`, so the `0047` policy
 * scopes `bms.assets` and `bms.rtus`; on the fleet branch (an admin or a
 * multi-organization scope) the `inArray` on `scoped` is the only isolation
 * control. `telemetry.point_values` has no RLS policy on either branch, and
 * `live` reads it fleet-wide, so the `scoped` join is what keeps another
 * tenant's assets out of both counts. An empty scope runs no query (plan
 * decision 7).
 *
 * **Devices** (`F3.16`, ADR 0127 decision 19). `monitored` counts the RTUs
 * with a `monitored_since` that serve an asset in scope, read inside the same
 * scoped transaction (`bms.rtu_health` is tenant-policied, `0149`), each with
 * its window from `rtuWindowsCteSql`; `offline` is those `rtuStateAt` judges
 * Offline against their host's beat. `bms.ingest_hosts` is read on `fleetDb`
 * after, and only when something in scope needs a host.
 */
@Injectable()
export class SystemStatusService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly queueHealth: QueueHealthService,
    private readonly storageHealth: StorageHealthService,
  ) {}

  async read(assetIds: string[] | null | undefined): Promise<SystemStatusResponse> {
    const scopeFilter = assetIds ? inArray(assets.id, assetIds) : sql`TRUE`;

    const [liveness, storage, scoped] = await Promise.all([
      this.queueHealth.read(),
      this.storageHealth.read(),
      withReadScope(
        this.db,
        this.fleetDb,
        assetIds,
        () => EMPTY_READ,
        async (tx): Promise<ScopedRead> => {
          const result = await tx.execute<StatusCountsRow>(sql`
            WITH scoped AS (
              SELECT assets.id, rtus.source_type
              FROM bms.assets
              JOIN bms.rtus ON rtus.id = assets.rtu_id
              WHERE ${scopeFilter}
            ),
            ${sql.raw(liveAssetsCteSql("SELECT id FROM scoped"))}
            SELECT
              COUNT(*)::int AS streaming_assets,
              COUNT(r.asset_id)::int AS fresh_assets,
              COUNT(*) FILTER (WHERE s.source_type = 'mqtt')::int AS mqtt_assets,
              COUNT(r.asset_id) FILTER (WHERE s.source_type = 'mqtt')::int AS mqtt_fresh
            FROM scoped s
            LEFT JOIN live r ON r.asset_id = s.id
          `);
          // F3.16 (ADR 0127 decision 19): the monitored RTUs serving an asset in scope.
          const monitored = await tx.execute<MonitoredRtuRow>(sql`
            WITH serving AS (
              SELECT DISTINCT assets.rtu_id
              FROM bms.assets
              WHERE ${scopeFilter} AND assets.rtu_id IS NOT NULL
            ),
            ${sql.raw(rtuWindowsCteSql("SELECT rtu_id FROM serving"))}
            SELECT h.host_key,
                   (extract(epoch FROM h.last_seen_at) * 1000)::float8 AS last_seen_ms,
                   (extract(epoch FROM h.monitored_since) * 1000)::float8 AS monitored_since_ms,
                   COALESCE(w.window_seconds, ${sql.raw(String(FRESHNESS_FLOOR_SECONDS))})::int AS window_seconds
            FROM serving s
            JOIN bms.rtu_health h ON h.rtu_id = s.rtu_id
            LEFT JOIN rtu_windows w ON w.rtu_id = s.rtu_id
            WHERE h.monitored_since IS NOT NULL
          `);
          return { counts: result.rows[0] ?? EMPTY_COUNTS, monitored: monitored.rows };
        },
      ),
    ]);

    const { counts, monitored } = scoped;
    // fleetDb: ingest_hosts is a platform table with no tenant column, which bms_tenant cannot
    // read (ADR 0127 decision 7); only the derived state and two counts leave this method.
    // Skipped when nothing in scope needs it, so an empty scope still runs no query.
    const { hosts, dbNowMs } =
      Number(counts.mqtt_assets) > 0 || monitored.length > 0
        ? await readIngestHosts(this.fleetDb)
        : { hosts: [] as HostBeat[], dbNowMs: 0 };
    const hostsByKey = new Map(hosts.map((h) => [h.hostKey, h]));
    const offline = monitored.filter(
      (row) =>
        rtuStateAt(
          { hostKey: row.host_key, lastSeenMs: row.last_seen_ms, monitoredSinceMs: row.monitored_since_ms },
          row.host_key === null ? undefined : hostsByKey.get(row.host_key),
          Number(row.window_seconds),
        ) === "offline",
    ).length;
    const serving = monitored.flatMap((row) => (row.host_key === null ? [] : [row.host_key]));
    const host = hostSummaryFor(hosts, serving, dbNowMs).state;

    const streaming = Number(counts.streaming_assets);
    const fresh = Number(counts.fresh_assets);
    const components: SystemComponent[] = [
      { key: "queue", state: queueComponentState(liveness.queue) },
      { key: "storage", state: storageComponentState(storage) },
      {
        key: "field_data",
        state: fieldDataState({ mqttAssets: Number(counts.mqtt_assets), host }),
      },
    ];

    return {
      status: verdict(components),
      components,
      dataQuality: {
        percent: dataQualityPercent(fresh, streaming),
        freshAssets: fresh,
        streamingAssets: streaming,
        windowSeconds: FRESHNESS_FLOOR_SECONDS,
      },
      devices: { monitored: monitored.length, offline },
      checkedAt: new Date().toISOString(),
    };
  }
}
