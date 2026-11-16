import { Inject, Injectable } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { ForecastListResponse, PointForecastResponse } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";
import { currentHourOf, toForecastListRow, toPointForecast } from "./ml-forecasts.pure";
import { readForecastList, readPointForecast } from "./ml-forecasts.reads";

/**
 * `E1.4a` / ADR 0135 Amendment 3 R-c, S1, S4 — the two forecast reads.
 *
 * **Both run through `withReadScope`, and nothing here touches a pool
 * otherwise** (`tests/e1.4a-ml-read-containment.test.ts`). A single-organization
 * caller reads inside `withTenant` on `bms_tenant`, which `0158` granted `SELECT`
 * on `ml.forecasts` and `ml.model_runs`, so `0157`'s FORCE policy scopes the
 * rows (S4). The `fleetDb` branch is `withReadScope`'s own, and its reason is
 * the one ADR 0043 decisions 2 and 3 name: a global admin's fleet-wide view, or
 * a caller whose readable assets span organizations, which one tenant GUC
 * cannot cover. There `bms_fleet` bypasses row security and the reads'
 * `asset_id = ANY(ids)` is the control (S1).
 *
 * The caller passes the request's one clock (R2); the current hour is computed
 * once from it and every read and every `stale` uses that value.
 */
@Injectable()
export class MlForecastsService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  /**
   * The current forecast for one point the controller has already decoded and
   * cleared with `canReadAsset`. `[assetId]` routes the read: a missing asset
   * resolves to no organization, and `onEmpty` answers `forecast: null`.
   */
  async current(point: { assetId: string; pointKey: string }, now: Date): Promise<PointForecastResponse> {
    const currentHourMs = currentHourOf(now);
    const forecast = await withReadScope(this.tenantDb, this.fleetDb, [point.assetId], () => null, async (tx) =>
      toPointForecast(await readPointForecast(tx, point, currentHourMs), currentHourMs),
    );
    return { asOf: now.toISOString(), forecast };
  }

  /** Every forecast point among `assetIds` (`readableAssetIds`' value; `null` is the global admin). */
  async list(assetIds: string[] | null, now: Date): Promise<ForecastListResponse> {
    const currentHourMs = currentHourOf(now);
    const rows = await withReadScope(this.tenantDb, this.fleetDb, assetIds, () => [], (tx) =>
      readForecastList(tx, assetIds, currentHourMs),
    );
    return { items: rows.map((row) => toForecastListRow(row, currentHourMs)) };
  }
}
