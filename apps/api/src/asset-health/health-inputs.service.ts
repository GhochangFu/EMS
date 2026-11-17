import { Inject, Injectable, Logger } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { AssetHealthInputsResponse, HealthBadActorsResponse } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withReadScope } from "../database/tenant-read-scope";
import { anomalyListSinceOf } from "../ml/ml-anomalies.pure";
import { AssetHealthService, type HealthLocationFilter } from "./asset-health.service";
import {
  lowestIdsOf,
  lowestScoresOf,
  toBadActorsAnomaly,
  toInputsResponse,
  type AnomalyHealthHoursDbRow,
  type AssetLabelDbRow,
  type OpenCorrectiveDbRow,
} from "./health-inputs.pure";
import { readAnomalyHealthHours, readAssetLabels, readOpenCorrective } from "./health-inputs.reads";

/** The class name of what a read threw, never its message: a driver error can carry SQL and values. */
const errorClassOf = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error;

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.6, R-b, R-g, R-h) — the SOW §4.3
 * five inputs of one asset, and the *Bad actors — advisory* read.
 *
 * **Every read is one `withReadScope`, and nothing here touches a pool
 * otherwise** (`tests/e1.8-health-inputs-containment.test.ts`). A
 * single-organization scope reads inside `withTenant` on `bms_tenant`, so the
 * row policies scope every `ml` and `bms` row; a global admin, or a scope that
 * spans organizations, reads on the fleet branch, where the reads' asset ids
 * are the control. The ids that route a read are the ids it filters by.
 *
 * **Each fact has its own transaction (R-g).** One failed statement aborts its
 * whole transaction, so the anomaly read and the ticket read never share one: a
 * failure gives `null` for that fact, one `warn` with a fixed message and the
 * error's class name (no asset id, no SQL, no message), and no error to the
 * caller (decision 9). The bad-actors route treats its anomaly half the same;
 * its scoring and label reads fail as the summary's would.
 *
 * **The rule score is not recomputed for one asset (R-b).** The inputs route
 * returns the hours and the penalty; the asset card subtracts it from the score
 * `GET /asset-health/assets/:assetId` already shows. The list scores the scope
 * once through `AssetHealthService.scoresInScope` (R-h), the summary's own step.
 *
 * Every method takes already-authorized ids: the controller's `canReadAsset` or
 * `readableAssetIds` has run first.
 */
@Injectable()
export class HealthInputsService {
  private readonly logger = new Logger(HealthInputsService.name);

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly health: AssetHealthService,
  ) {}

  /** One asset's five inputs, its anomaly history over the last 7 days and its open corrective tickets. */
  async forAsset(assetId: string, now: Date): Promise<AssetHealthInputsResponse> {
    const sinceMs = anomalyListSinceOf(undefined, now).sinceMs;
    let hours: AnomalyHealthHoursDbRow | undefined;
    try {
      const rows = await withReadScope(this.tenantDb, this.fleetDb, [assetId], () => [], (tx) =>
        readAnomalyHealthHours(tx, [assetId], sinceMs),
      );
      hours = rows.find((row) => row.asset_id === assetId);
    } catch (error) {
      this.quiet("anomaly history", error);
    }
    let tickets: OpenCorrectiveDbRow | undefined;
    try {
      tickets = await withReadScope(this.tenantDb, this.fleetDb, [assetId], () => undefined, (tx) =>
        readOpenCorrective(tx, assetId, now.getTime()),
      );
    } catch (error) {
      this.quiet("maintenance", error);
    }
    return toInputsResponse(assetId, hours, tickets, now);
  }

  /**
   * The *Bad actors* list, the *Lowest health score* tab and the count line, from one scoring of
   * the scope (R-h). `assetIds` and `location` are the summary's (R-d): `assetsInScope` narrows
   * them, so M is the donut's M. An empty scope answers the empty card and reads nothing more.
   */
  async badActors(
    assetIds: readonly string[] | null,
    location: HealthLocationFilter | undefined,
    windowMinutes: number,
    now: Date,
  ): Promise<HealthBadActorsResponse> {
    const scored = await this.health.scoresInScope(assetIds, location, windowMinutes, now);
    const inScopeIds = scored.map((entry) => entry.assetId);
    const asOf = now.toISOString();
    if (inScopeIds.length === 0) {
      return { asOf, scoredAssetCount: 0, lowestScores: [], anomaly: null };
    }

    const lowestIds = lowestIdsOf(scored);
    const labels: AssetLabelDbRow[] =
      lowestIds.length === 0
        ? []
        : await withReadScope(this.tenantDb, this.fleetDb, inScopeIds, () => [], (tx) =>
            readAssetLabels(tx, lowestIds),
          );

    const sinceMs = anomalyListSinceOf(undefined, now).sinceMs;
    let anomaly: HealthBadActorsResponse["anomaly"] = null;
    try {
      const rows = await withReadScope(this.tenantDb, this.fleetDb, inScopeIds, () => [], (tx) =>
        readAnomalyHealthHours(tx, inScopeIds, sinceMs),
      );
      anomaly = toBadActorsAnomaly(rows, new Map(scored.map((entry) => [entry.assetId, entry.score])), now);
    } catch (error) {
      this.quiet("bad actors", error);
    }

    return {
      asOf,
      scoredAssetCount: scored.filter((entry) => entry.score !== null).length,
      lowestScores: lowestScoresOf(scored, new Map(labels.map((label) => [label.asset_id, label]))),
      anomaly,
    };
  }

  /** Decision 9: one `warn` with a fixed message and the error's class name, and nothing else. */
  private quiet(fact: string, error: unknown): void {
    this.logger.warn({ fact, errorClass: errorClassOf(error) }, "asset health input read failed");
  }
}
