import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { assetPoints, assetTemplates, assets, automationRules, dashboards } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AdoptAssetsBody,
  JwtPayload,
  TemplateAdoptionPreviewResponse,
  TemplateAdoptionRefusalDto,
  TemplateAdoptionResultResponse,
  TemplateDashboardView,
  TemplateMigrationRefusalDto,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
// The override endpoint's cycle detector, the instance migrate uses. Exported by
// `CalcModule`, which `AdminModule` already imports. Read-only.
import { CalcDependencyService } from "../../calc/calc-dependency.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { constraintOf, translateConstraintErrors } from "../../database/translate-constraint-errors";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import { dashboardSlug, dashboardWidgetRowsFor, sortedViewNames } from "./asset-dashboards-plan";
import { planAdoption, type PlannedAdoption } from "./asset-templates-adopt-plan";
import {
  assertAlarmVocabulariesStillLive,
  assertBatchFits,
  assertRuleCodesFree,
  parseTemplateContentForInstantiate,
} from "./asset-templates-instantiate-guards";
import { refuseOverridesThatDoNotSurvive, type RefusedAsset } from "./asset-templates-migrate-calc";
import { translateAssetPointInsertUnique } from "./asset-templates-migrate-constraints";
import { refuseMetadataOverridesThatDoNotSurvive } from "./asset-templates-migrate-metadata";
import { catalogUnits, loadPoints, pointIdsByKey } from "./asset-templates-version-reads";
import { seededRuleValues, type SeededRuleInsert, type TemplateAlarm } from "./template-alarm-rules";

/**
 * `F4.312` — adopting a template-less asset onto one published template
 * version (ADR 0109 Amendment 1, rulings A1–A10; owner rulings 1–5 of
 * 2026-11-05).
 *
 * A fourth service under this directory rather than a method on
 * `AssetTemplateMigrationService`: that file is near AGENTS.md §4.5's cap, and
 * adoption has a different subject — an asset with **no** version to move
 * from, so there is no delta. What it shares with migrate it imports: the
 * version reads (`asset-templates-version-reads.ts`), the source-key resolver,
 * the insert's unique-violation sentences, and both override gates.
 *
 * ## The discipline, inherited from migrate
 *
 * **Every fallible decision is made before the transaction opens.** Access,
 * the version's status and content, every point's fate (`planAdoption`), the
 * converted formulas through the override's own checks (ruling 8), the kept
 * rows' metadata overrides, and the seeded rule codes are all resolved first;
 * the transaction only writes. `adopt` rebuilds the plan rather than trusting
 * a preview, and refuses on any refusal (owner ruling 1) — a half-adopted
 * batch is the outcome worse than failure.
 *
 * ## What one adoption writes (A5, owner ruling 2)
 *
 * `assets.template_id`; one `unmapped` `asset_points` row per measured point
 * the asset lacks (A3, no RTU even when the asset has one); the version's
 * seeded alarm rules and default dashboards, exactly as `instantiate` writes
 * them; one audit row. A converted standalone point needs **no** row write:
 * moving the pin moves its `computed` row from `CalcDefinitionsService`'s
 * standalone read to the template read, where it is the override, and its
 * history continues under `(asset_id, point_key)`. Derived points and KPIs
 * reach the asset through the pin. No maintenance plan — `instantiate` writes
 * none.
 *
 * ## Catalog
 *
 * The version's catalog units are read with migrate's non-refusing read, not
 * `assertCatalogActive` (owner ruling 4): an inactive catalog key does not
 * refuse adopting equipment that already exists.
 *
 * **E7.1b.** Every read before the transaction runs on `fleetDb`, trusting the
 * writable-scope grant this service computes first, as migrate does. The
 * write runs inside `withTenant(template.org)`; the pin `UPDATE` carries
 * `template_id IS NULL` and refuses (rolling back) on a short returned count.
 */

type TemplateRow = typeof assetTemplates.$inferSelect;

/**
 * Ceiling on refusals carried in a preview or an error body — migrate's 50,
 * for migrate's reason: the count keeps rising after the list stops.
 */
const MAX_REPORTED_REFUSALS = 50;

/** Everything `preview` and `adopt` need, computed once. */
type AdoptionPlan = {
  template: TemplateRow;
  planned: PlannedAdoption[];
  /** Capped at `MAX_REPORTED_REFUSALS`; `refusalCount` is the true total. */
  refusals: TemplateAdoptionRefusalDto[];
  refusalCount: number;
  alarms: TemplateAlarm[];
  views: Readonly<Record<string, TemplateDashboardView>>;
  /** The unit a seeded rule records, over every version point — instantiate's map. */
  unitByPointKey: ReadonlyMap<string, string | null>;
};

@Injectable()
export class AssetTemplateAdoptionService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    // The service instantiate re-checks a version's alarm vocabularies through.
    private readonly vocabularies: VocabulariesService,
    private readonly dependencies: CalcDependencyService,
    // `F3.2` / ADR 0067 — the default dashboards, written as instantiate writes them.
    private readonly assetDashboards: AssetDashboardsInstantiateService,
  ) {}

  /** The plan and the server's verdict. Writes nothing. */
  async preview(
    jwt: JwtPayload,
    templateId: string,
    body: AdoptAssetsBody,
  ): Promise<TemplateAdoptionPreviewResponse> {
    const plan = await this.buildPlan(jwt, templateId, body);
    return {
      templateId: plan.template.id,
      templateCode: plan.template.code,
      templateVersion: plan.template.version,
      assets: plan.planned.map((asset) => asset.dto),
      refusals: plan.refusals,
      refusalCount: plan.refusalCount,
      // The true total, not the capped list, so preview and adopt never disagree.
      canApply: plan.refusalCount === 0,
    };
  }

  /**
   * The explicit, audited act. The plan is rebuilt from the database rather
   * than taken from the client (owner ruling 1): a preview echoed back would
   * be a claim about rows that may have changed since.
   */
  async adopt(
    jwt: JwtPayload,
    templateId: string,
    body: AdoptAssetsBody,
  ): Promise<TemplateAdoptionResultResponse> {
    const plan = await this.buildPlan(jwt, templateId, body);
    if (plan.refusalCount > 0) {
      const hidden = plan.refusalCount - plan.refusals.length;
      throw new ConflictException({
        message:
          "This adoption is refused. Nothing was written. " +
          plan.refusals.map((r) => r.message).join(" ") +
          (hidden > 0 ? ` (${hidden} further refusals not shown.)` : ""),
        refusals: plan.refusals,
        refusalCount: plan.refusalCount,
      });
    }

    const { template } = plan;
    const assetIds = plan.planned.map((asset) => asset.dto.assetId);
    // One clock for the batch, as instantiate: every seeded rule carries one time.
    const now = new Date();

    // `translateRuleCodeCollision` rewrites only a `23505` on
    // `automation_rules_org_code_idx`; every other error passes through. A rule
    // code taken between the plan and the insert therefore rolls the WHOLE
    // transaction back — pin, rows, rules, dashboards and audit.
    const written = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      const updated = await tx
        .update(assets)
        .set({ templateId: template.id })
        // The planner's three whole-asset checks, restated on the write: still
        // template-less, still the version's organization and domain.
        .where(
          and(
            inArray(assets.id, assetIds),
            isNull(assets.templateId),
            eq(assets.organizationId, template.organizationId),
            eq(assets.domain, template.domain),
          ),
        )
        .returning({ id: assets.id });
      // Under 0047's FORCE an UPDATE whose row fails the tenant policy affects
      // zero rows without erroring, and `template_id IS NULL` misses an asset
      // pinned since the plan was read. Either is a partial adoption; turn it
      // into a loud rollback.
      if (updated.length !== assetIds.length) {
        throw new ConflictException(
          `Adoption matched ${updated.length} of ${assetIds.length} selected assets: the rest ` +
            "were pinned to a template, or moved to another organization or domain, since the " +
            "plan was read. Nothing was written.",
        );
      }

      const rows = plan.planned.flatMap((asset) =>
        asset.dto.added.map((point) => ({
          assetId: asset.dto.assetId,
          organizationId: template.organizationId,
          pointKey: point.pointKey,
          sourceDataKey: point.sourceDataKey,
          unit: point.unit,
          // A3: `unmapped`, with no RTU — even on an asset that has one. Nobody
          // has wired this point; `asset_points_source_ref_check` requires
          // `rtu_id` NULL for every kind but `measured`.
          rtuId: null,
          sourceKind: "unmapped",
          active: true,
        })),
      );
      if (rows.length > 0) {
        // The write-time net, as migrate: a row inserted after the plan was
        // read still reaches a unique index, and becomes a 409 with a sentence.
        await translateConstraintErrors(() => tx.insert(assetPoints).values(rows), {
          onUnique: (err) => translateAssetPointInsertUnique(err, "adoption"),
        });
      }

      // Converted points: no write (ruling 8) — see the class docblock.

      // Seeded rules exactly as instantiate writes them (ADR 0058), after the
      // points so a rule can evaluate at once, on this `tx`.
      const ruleValues: SeededRuleInsert[] = plan.planned.flatMap((asset) =>
        plan.alarms.map((alarm) =>
          seededRuleValues({
            alarm,
            assetId: asset.dto.assetId,
            assetCode: asset.dto.assetCode,
            organizationId: template.organizationId,
            template: { id: template.id, version: template.version },
            unit: plan.unitByPointKey.get(alarm.pointKey) ?? null,
            now,
          }),
        ),
      );
      if (ruleValues.length > 0) {
        await tx.insert(automationRules).values(ruleValues);
      }

      // Default dashboards (ADR 0067 d4), after the rules and on this `tx`, so
      // they bind to the rows just written and roll back with the batch.
      const dashboardsByCode = await this.assetDashboards.instantiateForAssets(
        tx,
        template,
        plan.views,
        plan.planned.map((asset) => ({
          id: asset.dto.assetId,
          code: asset.dto.assetCode,
          name: asset.dto.assetName,
        })),
      );
      const dashboardCount = [...dashboardsByCode.values()].reduce((n, r) => n + r.length, 0);

      // The open `tx`, never a second client — migrate's reason (the pool can
      // wedge), and it makes the audit row atomic with what it describes.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_template.adopt",
          entityType: "asset_template",
          entityId: template.id,
          organizationId: template.organizationId,
          payload: {
            code: template.code,
            version: template.version,
            assetIds,
            pointsCreated: rows.length,
            convertedPoints: plan.planned.reduce((n, a) => n + a.dto.converted.length, 0),
            ruleCount: ruleValues.length,
            dashboardCount,
          },
        },
        tx,
      );

      return { pointsCreated: rows.length, ruleCount: ruleValues.length, dashboardCount };
    }).catch((err: unknown) => {
      throw translateRuleCodeCollision(err);
    });

    return {
      templateId: template.id,
      templateCode: template.code,
      templateVersion: template.version,
      adoptedAssetIds: assetIds,
      assetCount: assetIds.length,
      assets: plan.planned.map((asset) => asset.dto),
      ...written,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * The whole fallible half, in one place, so preview and apply cannot
   * diverge. The access chain is migrate's verbatim (A10): authorize the
   * template before reading anything else about it, so a caller outside the
   * organization learns only that they cannot see it.
   */
  private async buildPlan(
    jwt: JwtPayload,
    templateId: string,
    body: AdoptAssetsBody,
  ): Promise<AdoptionPlan> {
    await this.accessControl.requireMasterDataUser(jwt);
    const template = await this.fetchTemplate(templateId);
    if (!(await this.accessControl.canManageOrganization(jwt, template.organizationId))) {
      throw new ForbiddenException("Template is outside your access scope");
    }
    if (template.status !== "published") {
      throw new ConflictException(
        `Assets can only adopt a published version; this one is ${template.status}. ` +
          "Publishing is what freezes the shape assets are pinned to.",
      );
    }

    const selected = await this.fleetDb
      .select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        organizationId: assets.organizationId,
        domain: assets.domain,
        templateId: assets.templateId,
        locationId: assets.locationId,
        sourceDataKeyVars: assets.sourceDataKeyVars,
      })
      .from(assets)
      .where(inArray(assets.id, body.assetIds));
    const byId = new Map(selected.map((asset) => [asset.id, asset]));
    const missing = body.assetIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `These asset ids do not exist: ${missing.join(", ")}. Nothing was written.`,
      );
    }

    // Migrate's `F4.64` count refusal: resolve the writable set once, count,
    // never name — a code the caller may not touch is not disclosed.
    const writableLocationIds = await this.accessControl.writableLocationIds(jwt);
    // A scoped caller's asset of another organization joins the same anonymous
    // count rather than the planner's named `organization_mismatch`: naming it
    // would disclose a code across the tenant boundary. A global administrator
    // (`null`) sees every organization, so the planner names it.
    const refused =
      writableLocationIds === null
        ? 0
        : selected.filter(
            (asset) =>
              asset.organizationId !== template.organizationId ||
              asset.locationId === null ||
              !writableLocationIds.includes(asset.locationId),
          ).length;
    if (refused > 0) {
      const noun = refused === 1 ? "asset" : "assets";
      const verb = refused === 1 ? "is" : "are";
      throw new ForbiddenException(
        `${refused} ${noun} in this batch ${verb} outside your access scope. Nothing was written.`,
      );
    }

    const points = await loadPoints(this.fleetDb, template.id);
    // Instantiate's content guards: a stored content that no longer parses, or
    // an alarm on a retired vocabulary value, refuses before anything is read
    // for the plan — never a silent zero-rule seed.
    const content = parseTemplateContentForInstantiate(template, "adopt");
    const alarms = content.alarms ?? [];
    const views = content.dashboards ?? {};
    await assertAlarmVocabulariesStillLive(this.vocabularies, this.fleetDb, alarms, template, "adopt");
    const units = await catalogUnits(this.fleetDb, points);
    const measuredCount = points.filter((point) => point.kind === "measured").length;
    assertBatchFits(selected.length, measuredCount, alarms.length, dashboardWidgetRowsFor(views));

    const existingRows = await this.fleetDb
      .select({
        assetId: assetPoints.assetId,
        pointKey: assetPoints.pointKey,
        sourceKind: assetPoints.sourceKind,
        sourceDataKey: assetPoints.sourceDataKey,
        unit: assetPoints.unit,
        // The five calc columns the override gate merges, and the five metadata
        // columns the metadata gate merges — the columns migrate reads.
        formula: assetPoints.formula,
        formulaDialect: assetPoints.formulaDialect,
        calcTrigger: assetPoints.calcTrigger,
        calcIntervalSeconds: assetPoints.calcIntervalSeconds,
        maxInputAgeSeconds: assetPoints.maxInputAgeSeconds,
        scaleMultiplier: assetPoints.scaleMultiplier,
        scaleOffset: assetPoints.scaleOffset,
        engMin: assetPoints.engMin,
        engMax: assetPoints.engMax,
        qualityPolicy: assetPoints.qualityPolicy,
      })
      .from(assetPoints)
      .where(inArray(assetPoints.assetId, body.assetIds));
    type ExistingRow = (typeof existingRows)[number];
    const rowsByAsset = new Map<string, ExistingRow[]>();
    for (const row of existingRows) {
      const list = rowsByAsset.get(row.assetId);
      if (list) list.push(row);
      else rowsByAsset.set(row.assetId, [row]);
    }

    // Bounded collector, migrate's: the count keeps rising after the list stops.
    const refusals: TemplateAdoptionRefusalDto[] = [];
    let refusalCount = 0;
    const refuse = (refusal: TemplateAdoptionRefusalDto): void => {
      refusalCount += 1;
      if (refusals.length < MAX_REPORTED_REFUSALS) {
        refusals.push(refusal);
      }
    };

    const ordered = body.assetIds.map((id) => byId.get(id) as (typeof selected)[number]);
    const planned = planAdoption({
      target: template,
      points,
      catalogUnits: units,
      assets: ordered.map((asset) => ({ asset, rows: rowsByAsset.get(asset.id) ?? [] })),
      refuse,
    });

    // The two override gates, on the assets the planner did not refuse whole.
    // A converted row is the asset's `computed` row merged over the version's
    // derived point — ruling 8's "through the override's own checks".
    const eligible = planned
      .filter((asset) => asset.eligible)
      .map((asset) => ({
        assetId: asset.dto.assetId,
        assetCode: asset.dto.assetCode,
        rows: new Map((rowsByAsset.get(asset.dto.assetId) ?? []).map((row) => [row.pointKey, row])),
      }));
    const fromGate = (refusal: TemplateMigrationRefusalDto, asset: RefusedAsset): void =>
      refuse({
        reason:
          refusal.reason === "metadata_override_invalid_on_target"
            ? "metadata_override_invalid_on_target"
            : "calc_override_invalid_on_target",
        assetId: asset.assetId,
        assetCode: asset.assetCode,
        pointKey: refusal.pointKey,
        message: refusal.message,
      });
    await refuseOverridesThatDoNotSurvive({
      assets: eligible,
      targetPoints: points,
      // Read only when some row is `computed`; the gate builds no candidate without it.
      targetPointIdsByKey: eligible.some((asset) =>
        [...asset.rows.values()].some((row) => row.sourceKind === "computed"),
      )
        ? await pointIdsByKey(this.fleetDb, template.id)
        : new Map<string, string>(),
      targetVersion: template.version,
      dependencies: this.dependencies,
      refuse: fromGate,
      operation: "adopt",
    });
    refuseMetadataOverridesThatDoNotSurvive({
      assets: eligible,
      targetPoints: points,
      targetVersion: template.version,
      refuse: fromGate,
      operation: "adopt",
    });

    await this.refuseTakenRuleCodes(template, eligible, alarms, refuse);
    await this.refuseTakenDashboardSlugs(template, eligible, views, refuse);

    return {
      template,
      planned,
      refusals,
      refusalCount,
      alarms,
      views,
      unitByPointKey: new Map(
        points.map((point) => [point.pointKey, point.unit ?? units.get(point.pointKey) ?? null]),
      ),
    };
  }

  /**
   * The seeded rule codes, checked with instantiate's own `assertRuleCodesFree`
   * one asset at a time against the assets accepted before it — so every
   * refusal is attributed to the asset that causes it: its own code taken, two
   * of its alarms deriving one code, or its code colliding with an earlier
   * asset's. At most 25 small reads, on a route that writes nothing. On
   * `fleetDb`: the check filters by organization itself.
   */
  private async refuseTakenRuleCodes(
    template: TemplateRow,
    eligible: readonly RefusedAsset[],
    alarms: TemplateAlarm[],
    refuse: (refusal: TemplateAdoptionRefusalDto) => void,
  ): Promise<void> {
    if (alarms.length === 0) {
      return;
    }
    const accepted: { code: string }[] = [];
    for (const asset of eligible) {
      try {
        await assertRuleCodesFree(
          this.fleetDb,
          template.organizationId,
          [...accepted, { code: asset.assetCode }],
          alarms,
        );
        accepted.push({ code: asset.assetCode });
      } catch (err) {
        if (!(err instanceof ConflictException)) {
          throw err;
        }
        refuse({
          reason: "rule_code_taken",
          assetId: asset.assetId,
          assetCode: asset.assetCode,
          pointKey: null,
          message: `Asset "${asset.assetCode}": ${err.message}`,
        });
      }
    }
  }

  /**
   * The default dashboards' slugs (`dashboardSlug(code, view)`), checked before
   * the transaction so the preview never says `canApply` where the insert
   * would 409 on `dashboards_organization_slug_key`: a slug derived twice by
   * the batch (two codes differing only in punctuation), or one already in the
   * organization. One read. Refused per asset, by code (`dashboard_slug_taken`).
   */
  private async refuseTakenDashboardSlugs(
    template: TemplateRow,
    eligible: readonly RefusedAsset[],
    views: Readonly<Record<string, TemplateDashboardView>>,
    refuse: (refusal: TemplateAdoptionRefusalDto) => void,
  ): Promise<void> {
    const viewNames = sortedViewNames(views);
    if (viewNames.length === 0 || eligible.length === 0) {
      return;
    }
    const wanted = eligible.map((asset) => ({
      asset,
      slugs: viewNames.map((view) => dashboardSlug(asset.assetCode, view)),
    }));
    const taken = new Set(
      (
        await this.fleetDb
          .select({ slug: dashboards.slug })
          .from(dashboards)
          .where(
            and(
              eq(dashboards.organizationId, template.organizationId),
              inArray(
                dashboards.slug,
                wanted.flatMap((entry) => entry.slugs),
              ),
            ),
          )
      ).map((row) => row.slug),
    );
    const firstHolder = new Map<string, string>();
    for (const { asset, slugs } of wanted) {
      const clashes: string[] = [];
      for (const slug of slugs) {
        const earlier = firstHolder.get(slug);
        if (taken.has(slug)) {
          clashes.push(`"${slug}" is already a dashboard in this organization`);
        } else if (earlier !== undefined && earlier !== asset.assetCode) {
          clashes.push(`"${slug}" is also derived for asset "${earlier}" in this batch`);
        } else {
          firstHolder.set(slug, asset.assetCode);
        }
      }
      if (clashes.length > 0) {
        refuse({
          reason: "dashboard_slug_taken",
          assetId: asset.assetId,
          assetCode: asset.assetCode,
          pointKey: null,
          message:
            `Asset "${asset.assetCode}": the version's default dashboard slug ${clashes.join("; ")}. ` +
            "A dashboard slug is unique per organization. Rename or delete that dashboard, or " +
            "adopt the assets in separate batches, then adopt.",
        });
      }
    }
  }

  private async fetchTemplate(id: string): Promise<TemplateRow> {
    const [row] = await this.fleetDb
      .select()
      .from(assetTemplates)
      .where(eq(assetTemplates.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset template not found");
    }
    return row;
  }
}

/**
 * The adoption's rule-code backstop — `translateAssetCodeCollision`'s rule
 * branch in this operation's words: adoption creates no asset, so "no asset, no
 * point and no rule" would be a sentence about the wrong act.
 */
export function translateRuleCodeCollision(err: unknown): unknown {
  if (constraintOf(err) === "automation_rules_org_code_idx") {
    return new ConflictException(
      "A rule code this template's alarms would seed was taken while the adoption was being " +
        "written. Nothing was written, so retry.",
    );
  }
  return err;
}
