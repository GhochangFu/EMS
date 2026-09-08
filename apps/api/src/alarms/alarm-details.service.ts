import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  alarmAffectedAssets,
  alarmEnrichments,
  alarmSkills,
  alarms,
  assetTemplates,
  assets,
  automationRules,
  locations,
  pointValues,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AlarmDetailsResponse, AutomationRuleOperator } from "@bms/shared";

/**
 * One `content.alarms[]` entry as the jsonb pick returns it (`E2.2`, ADR 0059).
 *
 * Deliberately loose: this is template content, and the authoring service —
 * not this read — is where it is validated. A shape that drifts must render
 * nothing here, never throw on an operator's alarm panel.
 */
type TemplateAlarmEntry = {
  philosophy?: {
    cause?: unknown;
    impact?: unknown;
    action?: unknown;
    skill?: unknown;
  } | null;
} | null;

/** A philosophy field is text or it is absent. Anything else is not shown. */
function philosophyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

import { FLEET_DRIZZLE } from "../database/database.tokens";

/**
 * `GET /api/v1/alarms/:id/details` (ADR 0034 decision 5).
 *
 * A separate service from `AlarmsService` rather than more methods on it:
 * that file is pagination and acknowledgement, this is a read composing five
 * tables, and the two share no state. Computed at read time — nothing here
 * is stored beyond the alarm/asset/rule/enrichment rows themselves.
 *
 * `F4.16` / ADR 0043 — the main query joins `locations` (RLS since migration
 * `0040`), so this whole read-only service runs on `fleetDb`. Every caller
 * already passes an `assetIds` scope it trusts (`AlarmsService.list` does the
 * same), so this is a pool change, not a new authorization surface.
 */
@Injectable()
export class AlarmDetailsService {
  constructor(@Inject(FLEET_DRIZZLE) private readonly db: BmsDb) {}

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
        // `F3.10` / ADR 0057 decision 1: the panel prints one of four states,
        // and "cleared, unacknowledged" is indistinguishable from "open"
        // without this stamp.
        clearedAt: alarms.clearedAt,
        ruleId: alarms.ruleId,
        assetCode: assets.code,
        assetName: assets.name,
        assetDomain: assets.domain,
        siteName: assets.siteName,
        locationName: locations.name,
        organizationId: locations.organizationId,
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
        // E2.2 / ADR 0059 decisions 2 and 3. The entry is picked in SQL, not by
        // pulling `content` into Node: that column is bounded at 256 KiB and an
        // alarm panel must not ship a whole template to find one object.
        // `jsonb_path_query_first` rather than `jsonb_array_elements` because it
        // returns NULL — instead of erroring — when `alarms` is absent or is not
        // an array, which is the shape a drifted template would have.
        classTemplateId: assetTemplates.id,
        classTemplateVersion: assetTemplates.version,
        classTemplateName: assetTemplates.name,
        classAlarmCode: automationRules.sourceAlarmCode,
        classAlarmEntry: sql<TemplateAlarmEntry>`jsonb_path_query_first(
          ${assetTemplates.content},
          '$.alarms[*] ? (@.code == $code)',
          jsonb_build_object('code', ${automationRules.sourceAlarmCode})
        )`,
      })
      .from(alarms)
      .innerJoin(assets, eq(alarms.assetId, assets.id))
      .innerJoin(locations, eq(assets.locationId, locations.id))
      .leftJoin(automationRules, eq(alarms.ruleId, automationRules.id))
      .leftJoin(alarmEnrichments, eq(alarmEnrichments.alarmId, alarms.id))
      // ADR 0059 decision 9. This service runs on `bms_fleet`, which carries
      // BYPASSRLS — RLS gives this join nothing, so the tenant predicate is
      // hand-written and `assertDetailsRefusesATemplateFromAnotherOrganization`
      // is what holds it. Delete the second `eq` and that test must fail.
      //
      // Two columns, not three: a row in `bms.asset_templates` IS a version
      // (ADR 0015), so `source_template_id` is already version-precise and
      // adding `source_template_version` here would only look stricter.
      .leftJoin(
        assetTemplates,
        and(
          eq(automationRules.sourceTemplateId, assetTemplates.id),
          eq(assetTemplates.organizationId, locations.organizationId),
        ),
      )
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

    // E2.2 / ADR 0059. Every field is read defensively: this is template content
    // validated by the authoring service, and a drifted shape must render
    // nothing on an operator's alarm panel rather than throw on it.
    const philosophy = row.classAlarmEntry?.philosophy ?? null;
    const cause = philosophyText(philosophy?.cause);
    const impact = philosophyText(philosophy?.impact);
    const action = philosophyText(philosophy?.action);
    const skillCode = philosophyText(philosophy?.skill);

    // No `active` filter, and that is decision 7 rather than an oversight:
    // retiring a skill is `active = false`, never a delete, so filtering here
    // would blank the field for exactly the older alarms most likely to carry
    // one. One row by primary key, and only when there is a code to resolve.
    const skillLabel =
      skillCode === null
        ? null
        : ((
            await this.db
              .select({ label: alarmSkills.label })
              .from(alarmSkills)
              .where(eq(alarmSkills.code, skillCode))
              .limit(1)
          )[0]?.label ?? null);

    return {
      id: row.id,
      assetId: row.assetId,
      organizationId: row.organizationId,
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
      clearedAt: row.clearedAt?.toISOString() ?? null,
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
      // An entry whose philosophy carries no text at all is `null`, not a
      // heading over four blank fields — the panel shows a class philosophy or
      // it shows nothing.
      //
      // Gated on `skillLabel`, not `skillCode`: an entry whose only field is a
      // skill that no longer resolves in `bms.alarm_skills` renders four blank
      // values, so it would draw the heading and its "Authored on …" caption
      // over an empty list. Template content holds the skill inside jsonb, so
      // no foreign key stops that row being re-coded after publish. Post-merge
      // review finding 4.
      classPhilosophy:
        row.classTemplateId !== null &&
        row.classTemplateVersion !== null &&
        row.classTemplateName !== null &&
        row.classAlarmCode !== null &&
        (cause !== null || impact !== null || action !== null || skillLabel !== null)
          ? {
              templateId: row.classTemplateId,
              templateVersion: row.classTemplateVersion,
              templateName: row.classTemplateName,
              alarmCode: row.classAlarmCode,
              cause,
              impact,
              action,
              skillCode,
              skillLabel,
            }
          : null,
    };
  }
}
