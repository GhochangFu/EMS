import { Inject, Injectable } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { SystemComponent, SystemStatusResponse } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";
import { QueueHealthService } from "../queue/queue-health.service";
import { StorageHealthService } from "../storage/storage-health.service";
import {
  REPORTING_ASSETS_CTE_SQL,
  REPORTING_WINDOW_SECONDS,
} from "../telemetry/telemetry-freshness";
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

/**
 * `F3.30` (ADR 0075 decisions 1, 3, 4) — the body of `GET
 * /api/v1/system/status`: three component states, one verdict, and the
 * data-quality figure for the caller's scope.
 *
 * **Components.** `queue` and `storage` are platform state, the same for every
 * caller (ADR 0075 ruled here 6), read from the providers `GET /health` uses.
 * Only the state crosses into the body — never a depth, bucket name,
 * heartbeat time or error text (decision 4). `field_data` is inferred from
 * the caller's own assets on `mqtt` RTUs (ruled here 5); the accepted limit
 * (decision 3) is that it reads `degraded` when every MQTT device is silent
 * although the ingest host runs, until `F3.16` gives a real heartbeat. There
 * is no `database` component: a database outage fails this request before any
 * component could report it, and the web renders that failure as the red
 * state.
 *
 * **The query.** `scoped` is every asset in scope with an RTU (the streaming
 * denominator, decision 1 — no `active` filter, plan decision 1);
 * `reporting` is the any-point CTE {@link REPORTING_ASSETS_CTE_SQL}, whose
 * window is the plan-time interval literal built from
 * `REPORTING_WINDOW_SECONDS` (150 s, ADR 0075 Amendment 1) — never a restated
 * number and never a bound parameter, which would plan every `point_values`
 * chunk. The one window drives both `dataQuality` and `field_data`, and is
 * returned as `windowSeconds`. It is wider than the 25 s live window the
 * location cards, the map and the class strip use, because the real MQTT
 * devices report every 60 s: this read asks "is data arriving?", not "is this
 * reading live?". `tests/f3.28-offline-bound-single-source.test.ts` pins this
 * file to the reporting CTE and forbids the live one. The SQL is unaliased so
 * Drizzle's `inArray(assets.id, …)` renders against `bms.assets`.
 *
 * **Scope.** `assetIds` is `readableAssetIds(user)` (`null` = unrestricted),
 * routed through `withReadScope`, and every read inside `fn` uses its `tx`.
 * A single-organization caller runs inside `withTenant`, so the `0047` policy
 * scopes `bms.assets` and `bms.rtus`; on the fleet branch (an admin or a
 * multi-organization scope) the `inArray` on `scoped` is the only isolation
 * control. `telemetry.point_values` has no RLS policy on either branch, and
 * `reporting` reads it fleet-wide, so the `scoped` join is what keeps another
 * tenant's assets out of both counts. An empty scope runs no query (plan
 * decision 7).
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

    const [liveness, storage, counts] = await Promise.all([
      this.queueHealth.read(),
      this.storageHealth.read(),
      withReadScope(
        this.db,
        this.fleetDb,
        assetIds,
        () => EMPTY_COUNTS,
        async (tx) => {
          const result = await tx.execute<StatusCountsRow>(sql`
            WITH scoped AS (
              SELECT assets.id, rtus.source_type
              FROM bms.assets
              JOIN bms.rtus ON rtus.id = assets.rtu_id
              WHERE ${scopeFilter}
            ),
            ${sql.raw(REPORTING_ASSETS_CTE_SQL)}
            SELECT
              COUNT(*)::int AS streaming_assets,
              COUNT(r.asset_id)::int AS fresh_assets,
              COUNT(*) FILTER (WHERE s.source_type = 'mqtt')::int AS mqtt_assets,
              COUNT(r.asset_id) FILTER (WHERE s.source_type = 'mqtt')::int AS mqtt_fresh
            FROM scoped s
            LEFT JOIN reporting r ON r.asset_id = s.id
          `);
          return result.rows[0] ?? EMPTY_COUNTS;
        },
      ),
    ]);

    const streaming = Number(counts.streaming_assets);
    const fresh = Number(counts.fresh_assets);
    const components: SystemComponent[] = [
      { key: "queue", state: queueComponentState(liveness.queue) },
      { key: "storage", state: storageComponentState(storage) },
      {
        key: "field_data",
        state: fieldDataState({
          mqttAssets: Number(counts.mqtt_assets),
          mqttFresh: Number(counts.mqtt_fresh),
        }),
      },
    ];

    return {
      status: verdict(components),
      components,
      dataQuality: {
        percent: dataQualityPercent(fresh, streaming),
        freshAssets: fresh,
        streamingAssets: streaming,
        windowSeconds: REPORTING_WINDOW_SECONDS,
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
