import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";

import {
  alarmAffectedAssets,
  alarmEnrichments,
  alarms,
  assets,
  automationRules,
  locations,
  pointValues,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AlarmDetailsResponse, AutomationRuleOperator } from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";

/**
 * `GET /api/v1/alarms/:id/details` (ADR 0034 decision 5).
 *
 * A separate service from `AlarmsService` rather than more methods on it:
 * that file is pagination and acknowledgement, this is a read composing five
 * tables, and the two share no state. Computed at read time — nothing here
 * is stored beyond the alarm/asset/rule/enrichment rows themselves.
 */
@Injectable()
export class AlarmDetailsService {
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  /**
   * Scoped by `assetIds` the same way `AlarmsService.list`/`acknowledge` are.
   * Raises `NotFoundException` rather than a distinguishing 403 — "not found
   * or outside your access scope" does not tell a caller whether the alarm
   * exists.
   */
  async get(alarmId: string, assetIds: string[] | null): Promise<AlarmDetailsResponse> {
    if (assetIds && assetIds.length === 0) {
      throw new NotFoundException("Alarm not found or outside your access scope");
    }

    const [row] = await this.db
      .select({
        id: alarms.id,
        assetId: alarms.assetId,
        severity: alarms.severity,
        message: alarms.message,
        raisedAt: alarms.raisedAt,
        acknowledgedAt: alarms.acknowledgedAt,
        acknowledgedBy: alarms.acknowledgedBy,
        ruleId: alarms.ruleId,
        assetCode: assets.code,
        assetName: assets.name,
        assetDomain: assets.domain,
        siteName: assets.siteName,
        locationName: locations.name,
        thresholdOperator: automationRules.operator,
        thresholdValue: automationRules.thresholdValue,
        rulePointKey: automationRules.pointKey,
        enrichmentId: alarmEnrichments.id,
        rootCause: alarmEnrichments.rootCause,
        impact: alarmEnrichments.impact,
        correctiveActions: alarmEnrichments.correctiveActions,
        energyImpact: alarmEnrichments.energyImpact,
        waterImpact: alarmEnrichments.waterImpact,
        productionImpact: alarmEnrichments.productionImpact,
        etrAt: alarmEnrichments.etrAt,
        skillCode: alarmEnrichments.skillCode,
        enrichmentUpdatedBy: alarmEnrichments.updatedBy,
        enrichmentUpdatedAt: alarmEnrichments.updatedAt,
      })
      .from(alarms)
      .innerJoin(assets, eq(alarms.assetId, assets.id))
      .innerJoin(locations, eq(assets.locationId, locations.id))
      .leftJoin(automationRules, eq(alarms.ruleId, automationRules.id))
      .leftJoin(alarmEnrichments, eq(alarmEnrichments.alarmId, alarms.id))
      .where(
        and(
          eq(alarms.id, alarmId),
          ...(assetIds ? [inArray(alarms.assetId, assetIds)] : []),
        ),
      )
      .limit(1);

    if (!row) {
      throw new NotFoundException("Alarm not found or outside your access scope");
    }

    // The latest sample for the linked rule's point, when there is a rule.
    // Not `DISTINCT ON` — this is a single (asset, pointKey) pair, so the
    // simple ORDER BY + LIMIT `RulesService.latestPointValue` uses is both
    // correct and fast here.
    const currentValue =
      row.ruleId && row.rulePointKey
        ? (
            await this.db
              .select({ time: pointValues.time, value: pointValues.value, unit: pointValues.unit })
              .from(pointValues)
              .where(and(eq(pointValues.assetId, row.assetId), eq(pointValues.pointKey, row.rulePointKey)))
              .orderBy(desc(pointValues.time))
              .limit(1)
          )[0] ?? null
        : null;

    const affectedAssets = row.enrichmentId
      ? await this.db
          .select({
            assetId: assets.id,
            assetCode: assets.code,
            assetName: assets.name,
          })
          .from(alarmAffectedAssets)
          .innerJoin(assets, eq(alarmAffectedAssets.assetId, assets.id))
          .where(
            and(
              eq(alarmAffectedAssets.enrichmentId, row.enrichmentId),
              ...(assetIds ? [inArray(assets.id, assetIds)] : []),
            ),
          )
      : [];

    return {
      id: row.id,
      assetId: row.assetId,
      assetCode: row.assetCode,
      assetName: row.assetName,
      assetDomain: row.assetDomain,
      locationName: row.locationName,
      siteName: row.siteName,
      severity: row.severity,
      message: row.message,
      raisedAt: row.raisedAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: row.acknowledgedBy,
      ruleId: row.ruleId,
      thresholdOperator: row.thresholdOperator as AutomationRuleOperator | null,
      thresholdValue: row.thresholdValue,
      currentValue: currentValue?.value ?? null,
      currentValueUnit: currentValue?.unit ?? null,
      currentValueAt: currentValue?.time.toISOString() ?? null,
      enrichment: row.enrichmentId
        ? {
            rootCause: row.rootCause,
            impact: row.impact,
            correctiveActions: row.correctiveActions,
            energyImpact: row.energyImpact,
            waterImpact: row.waterImpact,
            productionImpact: row.productionImpact,
            etrAt: row.etrAt?.toISOString() ?? null,
            skillCode: row.skillCode,
            updatedBy: row.enrichmentUpdatedBy,
            updatedAt: (row.enrichmentUpdatedAt as Date).toISOString(),
            affectedAssets,
          }
        : null,
    };
  }
}
