import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray, or } from "drizzle-orm";

import { alarmAffectedAssets, alarmEnrichments, alarms, auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
import type { AlarmEnrichmentUpsertBody } from "./enrichment.schema";

/**
 * `PUT /api/v1/alarms/:id/enrichment` (ADR 0034 decision 6).
 *
 * Operator-authored, not auto-populated from templates — no `automation_rules`
 * row links back to the `TemplateAlarm` it may have come from (see the ADR's
 * Context). An edit overwrites the row; there is no version history, matching
 * `bms.alarm_enrichments.alarm_id`'s `UNIQUE` constraint.
 *
 * **Scope beyond what ADR 0034 named**: gating with
 * `assertOperationsWriteRole` (done by the controller, matching `acknowledge`)
 * checks the caller's *role* only. Scoping the *alarm* by `assetIds` does not
 * scope the caller-supplied `affectedAssetIds` — without an explicit check, a
 * location-scoped operator could link assets outside their access, and
 * `AlarmDetailsService.get` would then read those asset names back to them. So
 * every `affectedAssetIds` entry is checked against `assetIds` here too.
 */
@Injectable()
export class AlarmEnrichmentService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    // E7.1b: the alarm scope read (behind assetIds, the isolation control) and
    // the actor identity read are both pre-tenant, so they run on fleetDb; the
    // write is then wrapped in the alarm's org.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly vocabularies: VocabulariesService,
  ) {}

  /**
   * The organization the alarm belongs to (`alarms.organization_id`), read on
   * fleetDb behind the caller's scope. `alarm_enrichments` and the junction it
   * writes all belong to it, so the whole upsert runs inside this org's GUC.
   */
  private async resolveAlarmOrg(alarmId: string, assetIds: string[] | null): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: alarms.organizationId })
      .from(alarms)
      .where(
        and(eq(alarms.id, alarmId), ...(assetIds ? [inArray(alarms.assetId, assetIds)] : [])),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException("Alarm not found or outside your access scope");
    }
    if (!row.organizationId) {
      throw new BadRequestException("Alarm has no organization; run the 0046 backfill");
    }
    return row.organizationId;
  }

  async upsert(
    alarmId: string,
    actor: Pick<JwtPayload, "sub" | "email">,
    body: AlarmEnrichmentUpsertBody,
    assetIds: string[] | null,
  ): Promise<void> {
    if (assetIds && assetIds.length === 0) {
      throw new NotFoundException("Alarm not found or outside your access scope");
    }

    // Validated before any write, so a bad skill or an out-of-scope affected
    // asset leaves nothing written — matching `assertTemplateAlarmVocabularies`'s
    // fail-before-write posture.
    if (body.skillCode) {
      await this.vocabularies.assertAlarmSkill(body.skillCode);
    }
    if (body.affectedAssetIds && assetIds) {
      const scoped = new Set(assetIds);
      const outOfScope = body.affectedAssetIds.filter((id) => !scoped.has(id));
      if (outOfScope.length > 0) {
        throw new BadRequestException(
          `affectedAssetIds outside your access scope: ${outOfScope.join(", ")}`,
        );
      }
    }

    const organizationId = await this.resolveAlarmOrg(alarmId, assetIds);

    const [actorRow] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, actor.sub), eq(users.email, actor.email)))
      .limit(1);
    const dbActorId = actorRow?.id ?? null;

    await withTenant(this.db, organizationId, async (tx) => {
      const fields: Partial<typeof alarmEnrichments.$inferInsert> = {};
      if (body.rootCause !== undefined) fields.rootCause = body.rootCause;
      if (body.impact !== undefined) fields.impact = body.impact;
      if (body.correctiveActions !== undefined) fields.correctiveActions = body.correctiveActions;
      if (body.energyImpact !== undefined) fields.energyImpact = body.energyImpact;
      if (body.waterImpact !== undefined) fields.waterImpact = body.waterImpact;
      if (body.productionImpact !== undefined) fields.productionImpact = body.productionImpact;
      if (body.etrAt !== undefined) fields.etrAt = body.etrAt ? new Date(body.etrAt) : null;
      if (body.skillCode !== undefined) fields.skillCode = body.skillCode;

      const [enrichment] = await tx
        .insert(alarmEnrichments)
        .values({ alarmId, organizationId, updatedBy: dbActorId, ...fields })
        .onConflictDoUpdate({
          target: alarmEnrichments.alarmId,
          set: { updatedBy: dbActorId, updatedAt: new Date(), ...fields },
        })
        .returning({ id: alarmEnrichments.id });
      if (!enrichment) {
        throw new Error("alarm enrichment upsert returned no row");
      }

      if (body.affectedAssetIds !== undefined) {
        // Scoped the same way the pre-write check above is: a scoped
        // caller's "replace" only replaces the subset they can see. An
        // unscoped delete here would silently destroy links to assets
        // outside the caller's access on every scoped edit — the read side
        // already filters those out (`AlarmDetailsService.get`), so the
        // caller never even sees them to know they existed.
        await tx
          .delete(alarmAffectedAssets)
          .where(
            and(
              eq(alarmAffectedAssets.enrichmentId, enrichment.id),
              ...(assetIds ? [inArray(alarmAffectedAssets.assetId, assetIds)] : []),
            ),
          );
        if (body.affectedAssetIds.length > 0) {
          await tx.insert(alarmAffectedAssets).values(
            body.affectedAssetIds.map((assetId) => ({
              enrichmentId: enrichment.id,
              assetId,
            })),
          );
        }
      }

      await tx.insert(auditLog).values({
        organizationId,
        actorId: dbActorId,
        action: "alarm_enrichment_update",
        entityType: "alarm",
        entityId: alarmId,
        payload: { alarmId, oidcSubject: actor.sub, actorEmail: actor.email, fields: body },
      });
    });
  }
}
