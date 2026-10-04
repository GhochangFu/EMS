import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { asc, eq } from "drizzle-orm";

import {
  assetPoints,
  assetTemplates,
  assets,
  automationRules,
  locations,
  organizations,
  rtus,
  templatePoints,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AssetInstantiationResultDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import type { BmsTx } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { resolveTelemetrySource, withTelemetrySource } from "../telemetry-source";
import type { TelemetrySource } from "../telemetry-source";
import { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import type { DashboardTargetAsset } from "./asset-dashboards-instantiate.service";
import { dashboardWidgetRowsFor } from "./asset-dashboards-plan";
import type {
  InstantiateAssetsBody,
  InstantiationTargetInput,
} from "./asset-templates.schema";
import {
  assertAlarmVocabulariesStillLive,
  assertAssetCodesFree,
  assertBatchFits,
  assertCatalogActive,
  assertRuleCodesFree,
  parseTemplateContentForInstantiate,
  planAsset,
  translateAssetCodeCollision,
} from "./asset-templates-instantiate-guards";
import type { InstantiationTarget } from "./asset-templates-instantiate-guards";
import type { TemplateRow } from "./asset-templates-write-guards";
import { seededRuleValues, type SeededRuleInsert } from "./template-alarm-rules";

/**
 * `F2.2` — building assets from a published template (ADR 0015 §6/§7 as
 * amended 2026-08-05).
 *
 * Split out of `AssetTemplatesAdminService` rather than added to it. That
 * service owns the *version lifecycle* — create, publish, archive, draft — and
 * was at 982 lines against AGENTS.md §4.5's 1000-line cap, with `F2.6` and
 * `F3.22` both queued against the same feature area. Instantiation is also the
 * only operation here that writes outside `asset_templates`/`template_points`,
 * so the seam is a real boundary and not just a size fix.
 */

/**
 * **`E2.4` / ADR 0058.** This service used to write exactly two tables. It now
 * writes three: every `content.alarms[]` entry of the published version becomes
 * one `bms.automation_rules` row per created asset, inside the same
 * transaction, with `source = 'template_alarm'` and the four provenance columns
 * migration `0067` added. The row derivation itself is pure and lives in
 * `template-alarm-rules.ts`; what lives here is the transaction, the two
 * pre-checks the new table needs (a rule-code collision scan and a row ceiling)
 * and the refusal to seed silently from content that no longer parses (D7).
 * `bms.rule_notifications` is deliberately **not** written — decision 2 makes a
 * seeded rule `review`, which raises an alarm and pages nobody until someone
 * joins a channel on purpose.
 *
 * `F4.16` / ADR 0043 — `asset_templates`, `locations` and `point_keys` carry
 * `ENABLE ROW LEVEL SECURITY` (migration `0040`); the reads against them here
 * (`fetchTemplate`, `resolveTarget`, `assertCatalogActive`) run on `fleetDb`,
 * trusting the scope filter this service already applies via
 * `canManageOrganization`/`canManageLocation`.
 *
 * **E7.1b.** `assets`, `asset_points` and `template_points` all became policied
 * tenant tables (`0046` column, `0047` policy + `FORCE`). The reads of them here
 * — the `template_points` load and the `assertAssetCodesFree` code-collision
 * check on `assets` — run on `fleetDb`; the collision check must see estate-wide
 * anyway (codes are globally unique), and the grant is applied only to decide
 * which taken codes may be named. The write transaction runs inside
 * `withTenant(template.org)` and stamps `organization_id` onto every asset and
 * asset_point — a single-org batch, since `resolveTarget` refuses a target in a
 * different org than the template.
 */
@Injectable()
export class AssetTemplateInstantiationService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    // `E2.4`: the same service `AssetTemplatesAdminService` publishes through,
    // so "live" means one thing on both sides of a published version. Reads are
    // uncached by design there, which is what makes a retirement visible to the
    // very next instantiate rather than after a restart.
    private readonly vocabularies: VocabulariesService,
    // `F3.2` / ADR 0067 d4 — required; an optional adapter would be inert.
    private readonly assetDashboards: AssetDashboardsInstantiateService,
  ) {}

  /**
   * Builds assets from a published template — model-once-deploy-many.
   *
   * All-or-nothing by construction. Every fallible decision — access, target
   * resolution, org match, catalog validity, code collisions, pattern
   * substitution — is made *before* the transaction opens, so the common
   * failures produce a named error instead of a rolled-back batch. The
   * transaction then only inserts, and exists so that a race we did not
   * pre-check (a concurrent create taking one of our codes) still leaves
   * nothing behind. Partial instantiation is the one outcome worse than
   * failure: forty assets where twelve are silently missing points is a
   * commissioning defect nobody finds until the plant is live.
   */
  async instantiate(
    jwt: JwtPayload,
    templateId: string,
    body: InstantiateAssetsBody,
  ): Promise<AssetInstantiationResultDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    const template = await this.fetchTemplate(templateId);

    // Authorize the template BEFORE reading anything else about it. Ordering
    // matters even though the reads below are side-effect free: checking status
    // or resolving a target first tells a caller outside this org that the
    // template exists, what lifecycle state it is in, and whether some RTU id
    // shares its organization — all before the 403. `getById` authorizes
    // immediately after the fetch; this now matches it.
    if (!(await this.accessControl.canManageOrganization(jwt, template.organizationId))) {
      throw new ForbiddenException("Template is outside your access scope");
    }

    if (template.status !== "published") {
      throw new ConflictException(
        `Only a published template can be instantiated; this one is ${template.status}. ` +
          "Publishing is what freezes the shape assets are built from.",
      );
    }

    const target = await this.resolveTarget(body.target);
    if (target.organizationId !== template.organizationId) {
      throw new BadRequestException(
        "Template belongs to a different organization than the target. A template may not " +
          "cross org boundaries — its point keys resolve against its own organization's catalog.",
      );
    }
    // ADR 0015 §7 as amended: the *write* half. `canManageTemplate` is not
    // consulted — it means "may author" and is false for location_admin by
    // design, so requiring it would deny the one role §7 exists to allow.
    if (!(await this.accessControl.canManageLocation(jwt, target.locationId))) {
      throw new ForbiddenException("Target location is outside your access scope");
    }

    // E7.1b: `template_points` read on `fleetDb` — a `FORCE`d tenant table in
    // `0047`, where a `tenantDb` read with no GUC would see zero points and this
    // would reject a valid template as having none.
    const points = await this.fleetDb
      .select()
      .from(templatePoints)
      .where(eq(templatePoints.templateId, templateId))
      .orderBy(asc(templatePoints.sortOrder), asc(templatePoints.pointKey));
    if (points.length === 0) {
      throw new ConflictException(
        "This template has no points; instantiating it would create assets with no telemetry",
      );
    }

    // Every key is re-validated, derived ones included (§6 step 3) — a template
    // published six months ago can name a key deactivated last week. Only
    // measured points become rows (§6 step 5): a derived point is computed by
    // the calc engine (`F2.6`), and there is no honest `source_data_key` for it.
    const catalogUnits = await assertCatalogActive(this.fleetDb, points, template);
    // `E2.4` D7. Read before anything is planned, so a version whose stored
    // content no longer parses fails here rather than instantiating assets with
    // silently zero rules — the one outcome ADR 0058 names as worse than a
    // refusal, because nobody inspects a batch that reported success.
    const content = parseTemplateContentForInstantiate(template);
    const alarms = content.alarms ?? [];
    const views = content.dashboards ?? {};
    // `E2.4`, and the same reason `assertCatalogActive` above exists: a template
    // published six months ago can name a *vocabulary* value retired last week.
    // Before the seed there was no consumer of a template alarm, so a retired
    // severity on one was inert; now every alarm becomes an `automation_rules`
    // row whose `category`/`severity` are closed by foreign keys.
    await assertAlarmVocabulariesStillLive(this.vocabularies, alarms, template);
    // The unit an alarm's rule records, keyed over **every** template point and
    // not over `measured` or a plan: the template override first, the catalog
    // unit second (D1). A derived point has no `asset_points` row and an
    // unresolvable optional one is skipped (D8), and both still seed a rule, so
    // sourcing this from the written points would silently drop their unit.
    const unitByPointKey = new Map(
      points.map((point) => [
        point.pointKey,
        point.unit ?? catalogUnits.get(point.pointKey) ?? null,
      ]),
    );
    const measured = points.filter((point) => point.kind === "measured");
    assertBatchFits(
      body.assets.length,
      measured.length,
      alarms.length,
      dashboardWidgetRowsFor(views),
    );

    await assertAssetCodesFree(this.fleetDb, this.accessControl, jwt, body.assets);
    await assertRuleCodesFree(this.fleetDb, template.organizationId, body.assets, alarms);
    const plans = body.assets.map((entry) => planAsset(entry, measured, catalogUnits));

    const sourceKind = target.rtuId ? "measured" : "unmapped";
    // One clock for the whole batch, matching `createDraft`: every rule seeded
    // by one press carries the same `created_at`/`published_at`.
    const now = new Date();
    // E7.1b: `assets` and `asset_points` are policied tenant tables since 0046.
    // The whole batch is one org — `resolveTarget` already refuses a target in a
    // different org than the template (above) — so the write runs inside
    // `withTenant(template.org)` and stamps that org onto every row.
    const created = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
        // `F4.139` — the third writer of `assets.rtu_id`, and the only one that
        // writes N of them at once. Before this, a batch deployed onto an
        // ingest-enabled RTU carried no `meta` at all, which `apps/sim` reads as
        // `sim` and the ingest host reads as `mqtt` — two producers on every row
        // of the batch, from the one screen that creates assets in bulk. The
        // invariant and the predicate live in `admin/telemetry-source.ts`.
        //
        // Resolved **once** for the whole batch, not per asset: one target means
        // one RTU, so a per-row call would be the same read N times. Every read
        // it needs runs on `tx` and never `fleetDb` — including the RTU's own
        // flags, which is why `deriveTelemetrySource` re-reads them here rather
        // than taking the row `resolveTarget` saw (second pass).
        const telemetrySource =
          target.rtuId === null ? null : await this.deriveTelemetrySource(tx, target.rtuId);
        const inserted = await tx
          .insert(assets)
          .values(
            plans.map((plan) => ({
              code: plan.entry.code,
              name: plan.entry.name,
              siteName: plan.entry.siteName ?? target.locationName,
              locationId: target.locationId,
              rtuId: target.rtuId,
              domain: template.domain,
              templateId: template.id,
              organizationId: template.organizationId,
              // `undefined` as the base and not a caller bag: `instantiateAssetBody`
              // has no `meta` field, so an instantiated asset's bag is exactly
              // this key or nothing at all.
              meta:
                telemetrySource === null
                  ? null
                  : withTelemetrySource(undefined, telemetrySource),
              active: true,
            })),
          )
          .returning({ id: assets.id, code: assets.code });

        // Keyed by code rather than trusting positional RETURNING order.
        const idByCode = new Map(inserted.map((row) => [row.code, row.id]));
        const pointValues = plans.flatMap((plan) => {
          const assetId = idByCode.get(plan.entry.code);
          if (!assetId) {
            throw new Error(`instantiate: no id returned for asset ${plan.entry.code}`);
          }
          return plan.points.map((point) => ({
            assetId,
            organizationId: template.organizationId,
            pointKey: point.pointKey,
            sourceDataKey: point.sourceDataKey,
            unit: point.unit,
            // ADR 0018's source axis. Through an RTU the points are `measured`
            // and carry it; through a location alone the honest record is
            // `unmapped` — nobody has claimed these are hand-entered, only that
            // no source is known yet. `asset_points_source_ref_check` requires
            // rtu_id to agree with source_kind, which both branches satisfy.
            rtuId: target.rtuId,
            sourceKind,
            active: true,
          }));
        });
        if (pointValues.length > 0) {
          await tx.insert(assetPoints).values(pointValues);
        }

        // `E2.4` / ADR 0058 decisions 1–4 and 9. Inside this `withTenant` block
        // and not after it: `bms.automation_rules` is a policied tenant table,
        // its `WITH CHECK` compares the stamped `organization_id` against the
        // GUC, and — the reason that matters operationally — a seed written
        // outside the transaction could survive a rolled-back batch as rules
        // pointing at assets that do not exist.
        //
        // One row per alarm per asset, keyed by asset code so the per-asset
        // `seededRules` in the response is the same array that was inserted
        // rather than a second derivation that could disagree with it.
        const seededByCode = new Map<string, string[]>();
        const ruleValues: SeededRuleInsert[] = [];
        // `F3.2` — collected here, not in a second `plans.map`.
        const dashboardTargets: DashboardTargetAsset[] = [];
        for (const plan of plans) {
          const assetId = idByCode.get(plan.entry.code);
          if (!assetId) {
            throw new Error(`instantiate: no id returned for asset ${plan.entry.code}`);
          }
          dashboardTargets.push({ id: assetId, code: plan.entry.code, name: plan.entry.name });
          const rows = alarms.map((alarm) =>
            seededRuleValues({
              alarm,
              assetId,
              assetCode: plan.entry.code,
              organizationId: template.organizationId,
              template: { id: template.id, version: template.version },
              unit: unitByPointKey.get(alarm.pointKey) ?? null,
              now,
            }),
          );
          ruleValues.push(...rows);
          seededByCode.set(
            plan.entry.code,
            rows.map((row) => row.code),
          );
        }
        if (ruleValues.length > 0) {
          await tx.insert(automationRules).values(ruleValues);
        }
        const disabledRuleCount = ruleValues.filter((row) => row.enabled === false).length;
        // `F3.2` / ADR 0067 d4 — after the rule seed and INSIDE this transaction
        // (ADR 0058 d9): a dashboard written outside it could survive a
        // rolled-back batch, owned by an asset that never existed.
        const byCode = await this.assetDashboards.instantiateForAssets(
          tx,
          template,
          views,
          dashboardTargets,
        );
        const dashboardCount = [...byCode.values()].reduce((n, r) => n + r.length, 0);

        // E7.1c (item D): folded into this transaction so the stamped
        // organizationId matches the GUC the strict WITH CHECK now demands.
        // Safe inside the `.catch` below: translateAssetCodeCollision only
        // rewrites a `23505` on `assets_code_unique` and passes any other
        // error (including one from this insert) through unchanged.
        await this.audit.write(
          {
            actor: jwt,
            action: "master.asset.instantiate",
            entityType: "asset_template",
            entityId: template.id,
            organizationId: template.organizationId,
            payload: {
              templateCode: template.code,
              templateVersion: template.version,
              locationId: target.locationId,
              rtuId: target.rtuId,
              assetIds: inserted.map((row) => row.id),
              pointCount: pointValues.length,
              // ADR 0058 decision 10: the audit row is the durable record of
              // how many rules one press armed, and how many commissioning
              // limits it left owed. The response is transient; this is not.
              ruleCount: ruleValues.length,
              disabledRuleCount,
              // `F3.2` / ADR 0067 decision 5, for decision 10's reason.
              dashboardCount,
            },
          },
          tx,
        );
        return {
          idByCode,
          pointCount: pointValues.length,
          seededByCode,
          ruleCount: ruleValues.length,
          disabledRuleCount,
          dashboardsByCode: byCode,
          dashboardCount,
        };
      })
      .catch((err: unknown) => {
        throw translateAssetCodeCollision(err);
      });

    const assetDtos = plans.map((plan) => {
      const id = created.idByCode.get(plan.entry.code);
      if (!id) {
        throw new Error(`instantiate: no id returned for asset ${plan.entry.code}`);
      }
      return {
        id,
        code: plan.entry.code,
        name: plan.entry.name,
        locationId: target.locationId,
        rtuId: target.rtuId,
        pointCount: plan.points.length,
        skippedPoints: plan.skippedPoints,
        // ADR 0058 decision 10 — the codes of the rules this asset was seeded
        // with, taken off the rows that were actually inserted rather than
        // re-derived here. Two derivations of one code is how the response and
        // the table drift apart.
        //
        // The `??` is unreachable, not a fallback: the loop above calls
        // `seededByCode.set` once per plan, including the template that carries
        // no alarms, where it sets an empty array. `plans` is the same array
        // being mapped here and the key is the same `plan.entry.code`, so a miss
        // would mean the two loops disagreed about their own input. It stays as
        // a total expression because a `[]` on the impossible branch is the same
        // value the zero-alarm case legitimately returns — unlike the `idByCode`
        // lookups above, which throw because a missing id there is a real
        // outcome (the database's `RETURNING` decides that one, not this code).
        seededRules: created.seededByCode.get(plan.entry.code) ?? [],
        // `F3.2` / ADR 0067 d5 — the views written for this asset, counted off
        // the returned rows. The `??` is unreachable for `seededRules`' reason.
        dashboards: created.dashboardsByCode.get(plan.entry.code) ?? [],
      };
    });

    return {
      templateId: template.id,
      templateCode: template.code,
      templateVersion: template.version,
      locationId: target.locationId,
      rtuId: target.rtuId,
      sourceKind,
      assets: assetDtos,
      assetCount: assetDtos.length,
      pointCount: created.pointCount,
      ruleCount: created.ruleCount,
      disabledRuleCount: created.disabledRuleCount,
      dashboardCount: created.dashboardCount,
    };
  }

  private async fetchTemplate(id: string): Promise<TemplateRow> {
    const [row] = await this.fleetDb
      .select({ template: assetTemplates })
      .from(assetTemplates)
      .innerJoin(organizations, eq(assetTemplates.organizationId, organizations.id))
      .where(eq(assetTemplates.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset template not found");
    }
    return row.template;
  }

  /**
   * Resolves the discriminated target to a location, org and optional gateway.
   *
   * An RTU supplies its own location, which is why the two are mutually
   * exclusive rather than combinable — and why the location used downstream is
   * always the *resolved* one, never a caller-supplied id.
   */
  private async resolveTarget(target: InstantiationTargetInput): Promise<InstantiationTarget> {
    if (target.kind === "rtu") {
      const [row] = await this.fleetDb
        .select({
          locationId: locations.id,
          locationName: locations.name,
          organizationId: locations.organizationId,
          rtuId: rtus.id,
          rtuActive: rtus.active,
          locationActive: locations.active,
        })
        .from(rtus)
        .innerJoin(locations, eq(rtus.locationId, locations.id))
        .where(eq(rtus.id, target.rtuId))
        .limit(1);
      if (!row) {
        throw new NotFoundException("RTU not found");
      }
      if (!row.rtuActive || !row.locationActive) {
        throw new BadRequestException(
          "Cannot instantiate onto an inactive RTU or location (ADR 0009)",
        );
      }
      return {
        locationId: row.locationId,
        locationName: row.locationName,
        organizationId: row.organizationId,
        rtuId: row.rtuId,
      };
    }

    const [row] = await this.fleetDb
      .select({
        locationId: locations.id,
        locationName: locations.name,
        organizationId: locations.organizationId,
        active: locations.active,
      })
      .from(locations)
      .where(eq(locations.id, target.locationId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Location not found");
    }
    if (!row.active) {
      throw new BadRequestException("Cannot instantiate into an inactive location (ADR 0009)");
    }
    return {
      locationId: row.locationId,
      locationName: row.locationName,
      organizationId: row.organizationId,
      // `F4.139` — gateway-less (ADR 0018). No RTU means no `telemetrySource`
      // on the assets this batch writes, and no read either: `catalog` here
      // would claim an answer nobody gave, and the invariant is over
      // RTU-attached assets only.
      rtuId: null,
    };
  }

  /**
   * `F4.139` (second pass) — the batch's `telemetrySource`, derived **entirely**
   * on the transaction that writes it.
   *
   * `resolveTarget` runs on `fleetDb` before `withTenant` opens that transaction,
   * so the `ingest_enabled`/`source_type` it read are from another connection at
   * an earlier moment. `resolveTelemetrySource` reads `rtu_connection_configs` on
   * `tx` for the reason `admin/telemetry-source.ts` gives, and feeding it flags
   * from `fleetDb` left the predicate split across two snapshots: an operator who
   * disabled the RTU while a commissioning batch was in flight got N assets
   * marked `mqtt` behind an RTU the ingest host no longer binds — dead points,
   * and no RTU edit repairs them because the assets did not exist when it ran.
   *
   * The row is re-read, not re-validated: `resolveTarget` has already refused an
   * inactive or out-of-organization RTU, and this read exists only to take the
   * two flags from inside the write. A missing row here is therefore not a user
   * error but a gateway deleted between the two reads, and the message says so
   * rather than repeating `resolveTarget`'s 404 text.
   */
  private async deriveTelemetrySource(tx: BmsTx, rtuId: string): Promise<TelemetrySource> {
    const [row] = await tx
      .select({
        id: rtus.id,
        ingestEnabled: rtus.ingestEnabled,
        sourceType: rtus.sourceType,
      })
      .from(rtus)
      .where(eq(rtus.id, rtuId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("RTU disappeared while the batch was being written");
    }
    return resolveTelemetrySource(tx, row);
  }
}
