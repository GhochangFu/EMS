import { Inject, Injectable } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { AnomalyListResponse, AssetAnomaliesResponse } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";
import { anomalyListSinceOf, anomalyWindowOf, toAnomalyList, toAnomalyScore } from "./ml-anomalies.pure";
import { readAnomalyList, readAssetAnomalies } from "./ml-anomalies.reads";

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e (Amendment 3 S1, S4) — the anomaly reads,
 * the forecast service's shape exactly.
 *
 * **Both run through `withReadScope`, and nothing here touches a pool
 * otherwise** (`tests/e1.2b-ml-anomaly-containment.test.ts`). A
 * single-organization caller reads inside `withTenant` on `bms_tenant`, which
 * the `E1.2b` grant migration grants `SELECT` on `ml.anomaly_scores`, so `0157`'s
 * FORCE policy scopes the rows (S4). The `fleetDb` branch is `withReadScope`'s
 * own: a global admin, or a caller whose readable assets span organizations.
 * There `bms_fleet` bypasses row security and the list's `asset_id = ANY(ids)`
 * is the control (S1).
 *
 * The caller passes the request's one clock; `asOf` is that instant.
 */
@Injectable()
export class MlAnomaliesService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  /**
   * One asset's scores over `window`, which the controller has already parsed
   * and cleared with `canReadAsset`. `[assetId]` routes the read: a missing
   * asset resolves to no organization, and `onEmpty` answers no scores.
   */
  async forAsset(assetId: string, window: { from: Date; to: Date }, now: Date): Promise<AssetAnomaliesResponse> {
    const bounds = anomalyWindowOf(window);
    const rows = await withReadScope(this.tenantDb, this.fleetDb, [assetId], () => [], (tx) =>
      readAssetAnomalies(tx, assetId, bounds.fromHourMs, bounds.endMs),
    );
    return { asOf: now.toISOString(), scores: rows.map(toAnomalyScore) };
  }

  /**
   * The unusual hours among `assetIds` (`readableAssetIds`' value; `null` is the
   * global admin) since `max(since, now − 7 days)`, newest first (R13).
   */
  async list(assetIds: string[] | null, since: Date | undefined, now: Date): Promise<AnomalyListResponse> {
    const window = anomalyListSinceOf(since, now);
    const rows = window.empty
      ? []
      : await withReadScope(this.tenantDb, this.fleetDb, assetIds, () => [], (tx) =>
          readAnomalyList(tx, assetIds, window.sinceMs),
        );
    return { asOf: now.toISOString(), since: new Date(window.sinceMs).toISOString(), ...toAnomalyList(rows) };
  }
}
