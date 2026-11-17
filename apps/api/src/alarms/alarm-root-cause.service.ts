import { Inject, Injectable } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { AlarmRootCauseSuggestionsResponse } from "@bms/shared";

import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { readAssetAnomalies } from "../ml/ml-anomalies.reads";

import { AlarmDetailsService } from "./alarm-details.service";
import { anomalyWindowBefore, buildRootCauseSuggestions, type RootCauseEvidence } from "./alarm-root-cause.pure";
import {
  readCoveringWindows,
  readLocationAncestorIds,
  readPastRootCauses,
  readRelatedAlarms,
  readSubjectAsset,
} from "./alarm-root-cause.reads";

/**
 * `E2.3` / ADR 0136 — `GET /api/v1/alarms/:id/root-cause-suggestions`, computed
 * at read time (plan `docs/plans/e2.3-root-cause-suggestions.md` §6 T1.5).
 *
 * 1. **The gate is `AlarmDetailsService.get`** (R-a), with the caller's
 *    `readableAssetIds` unchanged: the same 404, the same scope rule
 *    (`alarmVisibleTo`) and the same class-philosophy join as `/details`, and
 *    R5's source. No evidence is read before it answers.
 * 2. **A device alarm** (no asset) answers the empty lists and reads nothing
 *    more (Q4).
 * 3. **The evidence reads run in one `withTenant` transaction on `bms_tenant`**
 *    for the alarm's own organization (Q2), sequentially — one connection per
 *    request, no `Promise.all`. Row security is the backstop; every statement
 *    also keeps its hand-written organization predicate
 *    (`alarm-root-cause.reads.ts`). The anomaly read shares the transaction: it
 *    is the organization `withReadScope([assetId])` would resolve to.
 * 4. The ranking never sees the anomaly rows (R-h, decision 3).
 */
@Injectable()
export class AlarmRootCauseService {
  constructor(
    private readonly details: AlarmDetailsService,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
  ) {}

  async get(alarmId: string, assetIds: string[] | null, now: Date): Promise<AlarmRootCauseSuggestionsResponse> {
    const details = await this.details.get(alarmId, assetIds);
    const empty: AlarmRootCauseSuggestionsResponse = { computedAt: now.toISOString(), candidates: [], context: [] };
    const assetId = details.assetId;
    if (assetId === null) return empty;
    const { organizationId, ruleId } = details;

    return withTenant(this.tenantDb, organizationId, async (tx) => {
      const asset = await readSubjectAsset(tx, organizationId, alarmId, assetId);
      // An alarm whose organization is not its asset's reads as no asset here.
      if (asset === null) return empty;
      const raisedMs = asset.raisedMs;

      const windows = await readCoveringWindows(tx, organizationId, assetId, raisedMs);
      const locationAncestorIds = windows.some((w) => w.locationIds.length > 0)
        ? await readLocationAncestorIds(tx, organizationId, asset.locationId)
        : [];
      const related = await readRelatedAlarms(tx, {
        organizationId,
        alarmId,
        assetId,
        rtuId: asset.rtuId,
        locationId: asset.locationId,
        raisedMs,
      });
      const pastRootCauses =
        ruleId === null ? [] : await readPastRootCauses(tx, { organizationId, alarmId, assetId, ruleId, raisedMs });
      const window = anomalyWindowBefore(raisedMs);
      const anomalyRows = await readAssetAnomalies(tx, assetId, window.fromHourMs, window.endMs);

      const evidence: RootCauseEvidence = {
        subject: {
          alarmId,
          organizationId,
          raisedAtMs: raisedMs,
          assetId,
          ruleId,
          rtuId: asset.rtuId,
          rtuName: asset.rtuName,
          locationId: asset.locationId,
          locationAncestorIds,
        },
        windows,
        rtuCommsAlarms: related.filter((row) => row.source === "rtu_comms"),
        relatedAlarms: related.filter((row) => row.source === "rule"),
        pastRootCauses,
        classCause: details.classPhilosophy,
      };
      return buildRootCauseSuggestions(evidence, anomalyRows, now);
    });
  }
}
