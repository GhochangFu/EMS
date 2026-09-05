import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { assetPoints, assetTemplates, assets, pointKeys, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  TemplateMigrationAssetDto,
  TemplateMigrationPreviewResponse,
  TemplateMigrationRefusalDto,
  TemplateMigrationResultResponse,
  TemplateMigrationSkippedPointDto,
  TemplateVersionDeltaDto,
  TemplateVersionsListResponse,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
// `F2.9` PR 2 review fix 2 — the override endpoint's *second* gate. Exported by
// `CalcModule`, which `AdminModule` already imports.
import { CalcDependencyService } from "../../calc/calc-dependency.service";
import { SOURCE_DATA_KEY_MAX_LENGTH } from "../../calc/computed-source-data-key";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
// `F2.9` Task 12b, widened at the PR 2 review — the override endpoint's own two
// gates, imported rather than restated. See that file's docblock.
import { refuseOverridesThatDoNotSurvive } from "./asset-templates-migrate-calc";
import type { MigrateAssetsBody } from "./asset-templates-migrate.schema";
import { computeTemplateVersionDelta, type StoredTemplatePoint } from "./template-version-delta";

/**
 * `F2.6` — moving assets from one published template version to another
 * (ADR 0039).
 *
 * A third service under this directory rather than a fourth method on
 * `AssetTemplatesAdminService`, for the same two reasons
 * `AssetTemplateInstantiationService` was split out: that file is near
 * AGENTS.md §4.5's 1000-line cap, and this is the second operation in the
 * module that writes outside `asset_templates`/`template_points`. The seam is
 * a real boundary, not a size fix.
 *
 * ## The discipline, inherited from instantiation
 *
 * **Every fallible decision is made before the transaction opens.** Access,
 * version identity, lifecycle status, the domain check, the delta, and every
 * `source_data_key` substitution are all resolved first; the transaction only
 * writes. Partial migration is the outcome worse than failure — half an estate
 * pinned to a new version, with some assets missing the points that version
 * added, is a commissioning defect nobody finds until a formula quietly stops
 * producing.
 *
 * ## What refuses, and why
 *
 * - **Decision 3** — a delta that removes or re-keys a measured point. The
 *   `asset_points` row is physical wiring `apps/ingest` and the rule engine
 *   read, and no automatic reconciliation of it is honest.
 * - **Q-A, ruled 2026-08-22** — a *required* measured addition whose
 *   `source_data_key_pattern` uses any token beyond `{asset_code}`. Migration
 *   has no `sourceDataKeyVars`: instantiation takes them per request and never
 *   persists them, so there is nothing to recover for an asset built months
 *   ago. Only `{asset_code}` can be reconstructed, from `assets.code`. An
 *   *optional* such point is skipped and reported, exactly as at instantiation.
 *   The accepted cost is that a template whose patterns use richer tokens can
 *   never be migrated — those assets must be rebuilt.
 * - **Q-B, ruled 2026-08-22** — the target version declares a different
 *   `domain`. A domain change moves assets between plant-domain views, rule
 *   categories (ADR 0031) and dashboards, and `assets_domain_fk` would not
 *   catch it because both values are valid domain codes. Migrating the pin and
 *   leaving `assets.domain` alone would make the pin and the asset disagree,
 *   which is the one thing ADR 0015's identity invariant exists to prevent.
 * - **`F2.9` Task 12b** — a migrating asset's own calc override, merged over
 *   the target version's declaration of the same derived point, that either of
 *   the override endpoint's two gates refuses: `validateMergedCalcOverride`,
 *   or `CalcDependencyService.checkCandidate`. The delta is pure over two
 *   template versions and never sees an override, so without this the pin could
 *   move under a legal dialect-only override and leave a `bms-calc-v2` formula
 *   wearing a `bms-calc-v1` label — a pair no code path had validated
 *   (findings 31 and 34). `asset-templates-migrate-calc.ts` holds both, and
 *   states exactly what parity with that endpoint does and does not claim.
 */

type TemplateRow = typeof assetTemplates.$inferSelect;

/**
 * Ceiling on `asset_points` rows created by one migration.
 *
 * The same Postgres bind-parameter ceiling and the same statement shape as
 * `AssetTemplateInstantiationService.MAX_POINT_ROWS`. Set well under the hard
 * limit so a legitimately large batch gets a domain error rather than a raw
 * driver one.
 */
const MAX_POINT_ROWS = 8_000;

/**
 * Ceiling on refusals carried in a plan, a preview or an error body.
 *
 * `assetIds` is capped at 200 and a version at 500 points, and the
 * `unresolvable_source_data_key` and `point_key_already_mapped` refusals are
 * pushed per asset *per point* — so one `migration-preview`, which writes
 * nothing and audits nothing and is therefore freely repeatable, could otherwise
 * materialise ~100,000 objects each carrying a paragraph. `MAX_POINT_ROWS`
 * cannot catch it: that is checked in `migrate` only, after `buildPlan` has
 * already built the arrays.
 *
 * The whole migration is refused if there is a single refusal, so an operator
 * needs a readable sample and the total, not every sentence.
 */
const MAX_REPORTED_REFUSALS = 50;

/** Only `{asset_code}` survives into a migration — see Q-A above. */
const MIGRATION_RESOLVABLE_VAR = "asset_code";

/** `{token}` in a `source_data_key_pattern`. */
const PATTERN_TOKEN = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * `bms.asset_points.source_data_key` is `varchar(128)`.
 *
 * Imported rather than restated. `U4` of this feature extracted the constant on
 * the "two creators must not drift" argument, and this service is a third
 * creator of the same rows.
 */
const SOURCE_DATA_KEY_MAX = SOURCE_DATA_KEY_MAX_LENGTH;

/** One selected asset, with the version it is pinned to and what it needs. */
type PlannedAsset = {
  dto: TemplateMigrationAssetDto;
  rtuId: string | null;
  /** Rows to insert for the measured points the target version adds. */
  newPoints: { pointKey: string; sourceDataKey: string; unit: string | null }[];
  skipped: TemplateMigrationSkippedPointDto[];
};

/** Everything both `previewMigration` and `migrate` need, computed once. */
type MigrationPlan = {
  target: TemplateRow;
  planned: PlannedAsset[];
  deltas: TemplateVersionDeltaDto[];
  /** Capped at `MAX_REPORTED_REFUSALS`; `refusalCount` is the true total. */
  refusals: TemplateMigrationRefusalDto[];
  refusalCount: number;
  fromVersions: number[];
};

/**
 * `F4.16` / ADR 0043 — `asset_templates` and `point_keys` carry `ENABLE ROW
 * LEVEL SECURITY` (migration `0040`); reads against them run on `fleetDb`,
 * trusting the scope filter this service already applies via
 * `writableLocationIds`/`canManageOrganization`.
 *
 * **E7.1b.** `assets`, `asset_points` and `template_points` all became policied
 * tenant tables (`0046` column, `0047` policy + `FORCE`). Every read of them
 * here runs on `fleetDb` — the two `template_points` reads (version-list point
 * count, `loadPoints`) and the `assets`/`asset_points` reads (version-list asset
 * count, the selected-asset load, the existing-points delta read) — trusting the
 * same already-computed writable-scope grant. `migrate()`'s write transaction
 * runs inside `withTenant(target.org)`, stamps `organization_id` on the new
 * points, and refuses (rolling back) if the `assets.template_id` UPDATE matches
 * fewer rows than were selected — under `FORCE` a policy-failing UPDATE is a
 * silent zero-row no-op, and a partial migration is this file's stated
 * worse-than-failure outcome.
 */
@Injectable()
export class AssetTemplateMigrationService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    // `F2.9` PR 2 review fix 2 — the save-time cycle detector, the same
    // instance `AssetPointCalcOverrideService` uses. Read-only: it resolves a
    // graph and reports, and writes nothing.
    private readonly dependencies: CalcDependencyService,
  ) {}

  /**
   * Every version of this template's code, newest first, with how much of the
   * estate sits on each (ADR 0039 decision 8).
   *
   * The counts are what make the view worth having: "which of these versions is
   * still in service" is the question a migration answers.
   */
  async listVersions(jwt: JwtPayload, templateId: string): Promise<TemplateVersionsListResponse> {
    await this.accessControl.requireMasterDataUser(jwt);
    const template = await this.fetchTemplate(templateId);
    if (!(await this.accessControl.canManageOrganization(jwt, template.organizationId))) {
      throw new ForbiddenException("Template is outside your access scope");
    }

    const versions = await this.fleetDb
      .select({
        id: assetTemplates.id,
        version: assetTemplates.version,
        status: assetTemplates.status,
        publishedAt: assetTemplates.publishedAt,
      })
      .from(assetTemplates)
      .where(
        and(
          eq(assetTemplates.organizationId, template.organizationId),
          eq(assetTemplates.code, template.code),
        ),
      )
      .orderBy(desc(assetTemplates.version));

    const ids = versions.map((v) => v.id);

    // Scoped to what this caller can act on. A `location_admin` passes
    // `canManageOrganization` — their org is derived from their locations — so
    // an unscoped count would report the whole estate while `buildPlan` refuses
    // every asset outside their locations. Decision 8 defines this view as
    // "which assets sit on which version"; for this caller that is their own
    // assets, and a number they cannot act on is worse than no number.
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const assetScope =
      writableIds === null
        ? inArray(assets.templateId, ids)
        : and(inArray(assets.templateId, ids), inArray(assets.locationId, writableIds));
    // E7.1b: `assets` read on `fleetDb` — a `FORCE`d tenant table in `0047`
    // where a `tenantDb` read with no GUC sees zero rows. `assetScope` already
    // filters by the caller's `writableIds`, so the grant is the isolation
    // control (Amendment 3).
    const assetCounts =
      writableIds !== null && writableIds.length === 0
        ? []
        : await this.fleetDb
            .select({ templateId: assets.templateId, total: count() })
            .from(assets)
            .where(assetScope)
            .groupBy(assets.templateId);
    // E7.1b: `template_points` read on `fleetDb` — a `FORCE`d tenant table in
    // `0047`. (The `assets` count above stays on `tenantDb` pending the
    // master-data-writers unit; see the class doc.)
    const pointCounts = await this.fleetDb
      .select({ templateId: templatePoints.templateId, total: count() })
      .from(templatePoints)
      .where(inArray(templatePoints.templateId, ids))
      .groupBy(templatePoints.templateId);

    const assetsBy = new Map(assetCounts.map((row) => [row.templateId, row.total]));
    const pointsBy = new Map(pointCounts.map((row) => [row.templateId, row.total]));

    return {
      items: versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status as TemplateVersionsListResponse["items"][number]["status"],
        publishedAt: v.publishedAt?.toISOString() ?? null,
        assetCount: assetsBy.get(v.id) ?? 0,
        pointCount: pointsBy.get(v.id) ?? 0,
      })),
    };
  }

  /** Decision 2 — the delta, and the server's verdict. Writes nothing. */
  async previewMigration(
    jwt: JwtPayload,
    targetId: string,
    body: MigrateAssetsBody,
  ): Promise<TemplateMigrationPreviewResponse> {
    const plan = await this.buildPlan(jwt, targetId, body);
    return this.toPreview(plan);
  }

  /**
   * Decision 1 — the explicit, audited act.
   *
   * The plan is rebuilt from the database rather than taken from the client.
   * A preview echoed back would be a claim about rows that may have changed
   * since, and the whole point of decision 2 is that the *server* decides
   * whether this migration is safe.
   */
  async migrate(
    jwt: JwtPayload,
    targetId: string,
    body: MigrateAssetsBody,
  ): Promise<TemplateMigrationResultResponse> {
    const plan = await this.buildPlan(jwt, targetId, body);

    if (plan.refusals.length > 0) {
      const hidden = plan.refusalCount - plan.refusals.length;
      throw new ConflictException({
        message:
          "This migration is refused. Nothing was written. " +
          plan.refusals.map((r) => r.message).join(" ") +
          (hidden > 0 ? ` (${hidden} further refusals not shown.)` : ""),
        refusals: plan.refusals,
        refusalCount: plan.refusalCount,
      });
    }

    const totalNewPoints = plan.planned.reduce((sum, a) => sum + a.newPoints.length, 0);
    if (totalNewPoints > MAX_POINT_ROWS) {
      throw new BadRequestException(
        `This migration would create ${totalNewPoints} asset points, over the ` +
          `${MAX_POINT_ROWS} limit for one call. Split it into smaller batches.`,
      );
    }

    const assetIds = plan.planned.map((a) => a.dto.assetId);
    if (assetIds.length === 0) {
      // Every selected asset is already on the target version. Not an error —
      // a re-submitted migration is the common way this happens — but it must
      // write nothing, including no audit row claiming a migration occurred.
      return this.toResult(plan, 0);
    }

    // E7.1b: `assets` and `asset_points` are policied tenant tables since 0046.
    // Every selected asset is same-org as the target — the version-identity
    // check in `buildPlan` refuses a source template in another org, and
    // instantiation never places an asset outside its template's org — so the
    // write runs inside `withTenant(target.org)` and stamps that org onto every
    // new point row.
    await withTenant(this.tenantDb, plan.target.organizationId, async (tx) => {
      const updated = await tx
        .update(assets)
        .set({ templateId: plan.target.id })
        .where(inArray(assets.id, assetIds))
        .returning({ id: assets.id });
      // Under 0047's FORCE, an UPDATE whose row fails the tenant policy affects
      // zero rows WITHOUT erroring. A short count therefore means a selected
      // asset is not in the target org — a silent partial migration, which this
      // file's header names the outcome worse than failure. Turn it into a loud
      // rollback rather than a 200 that pinned only some of the batch.
      if (updated.length !== assetIds.length) {
        throw new ConflictException(
          `Migration matched ${updated.length} of ${assetIds.length} selected assets under the ` +
            `target organization's tenant boundary; the rest are outside it. Nothing was written.`,
        );
      }

      const rows = plan.planned.flatMap((a) =>
        a.newPoints.map((point) => ({
          assetId: a.dto.assetId,
          organizationId: plan.target.organizationId,
          pointKey: point.pointKey,
          sourceDataKey: point.sourceDataKey,
          unit: point.unit,
          // ADR 0018's source axis, and `asset_points_source_ref_check`:
          // `measured` requires an rtu_id, everything else requires none. The
          // asset already knows which it is, so the new row inherits the same
          // provenance instantiation would have given it.
          rtuId: a.rtuId,
          sourceKind: a.rtuId ? "measured" : "unmapped",
          active: true,
        })),
      );
      if (rows.length > 0) {
        await tx.insert(assetPoints).values(rows);
      }

      // The open `tx`, not a second client. `MasterDataAuditService.write`'s
      // own docblock requires this inside a transaction: the pool is `max: 10`
      // with no acquisition timeout, so asking for another client mid-
      // transaction can wedge every pooled client with nothing to break the
      // deadlock. It also makes the audit row atomic with what it describes.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_template.migrate",
          entityType: "asset_template",
          entityId: plan.target.id,
          organizationId: plan.target.organizationId,
          payload: {
            code: plan.target.code,
            fromVersions: plan.fromVersions,
            toVersion: plan.target.version,
            assetIds,
            pointsCreated: rows.length,
          },
        },
        tx,
      );
    });

    return this.toResult(plan, totalNewPoints);
  }

  // -------------------------------------------------------------------------

  private toPreview(plan: MigrationPlan): TemplateMigrationPreviewResponse {
    return {
      templateCode: plan.target.code,
      toVersionId: plan.target.id,
      toVersion: plan.target.version,
      assets: plan.planned.map((a) => a.dto),
      deltas: plan.deltas,
      refusals: plan.refusals,
      // The true total, not the capped list — a preview that showed 50 of 300
      // refusals and then said `canApply` must never disagree with `migrate`.
      canApply: plan.refusalCount === 0,
    };
  }

  private toResult(plan: MigrationPlan, pointsCreated: number): TemplateMigrationResultResponse {
    return {
      templateCode: plan.target.code,
      toVersionId: plan.target.id,
      toVersion: plan.target.version,
      fromVersions: plan.fromVersions,
      migratedAssetIds: plan.planned.map((a) => a.dto.assetId),
      assetCount: plan.planned.length,
      pointsCreated,
      skippedPoints: plan.planned.flatMap((a) => a.skipped),
    };
  }

  /**
   * The whole fallible half, in one place, so preview and apply cannot diverge.
   *
   * Order matters and is the same as instantiation's: authorize the template
   * before reading anything else about it, so a caller outside the org learns
   * only that they cannot see it — not its lifecycle state, nor which of their
   * guessed asset ids exist.
   */
  private async buildPlan(
    jwt: JwtPayload,
    targetId: string,
    body: MigrateAssetsBody,
  ): Promise<MigrationPlan> {
    await this.accessControl.requireMasterDataUser(jwt);
    const target = await this.fetchTemplate(targetId);
    if (!(await this.accessControl.canManageOrganization(jwt, target.organizationId))) {
      throw new ForbiddenException("Template is outside your access scope");
    }
    if (target.status !== "published") {
      throw new ConflictException(
        `Assets can only be migrated onto a published version; this one is ${target.status}. ` +
          "Publishing is what freezes the shape assets are pinned to.",
      );
    }

    // E7.1b: `assets` read on `fleetDb` — FORCEd in 0047; a tenantDb read with
    // no GUC would see zero rows and report every selected id as nonexistent.
    // The writable-scope filter below (F4.64) is the isolation control.
    const selected = await this.fleetDb
      .select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        rtuId: assets.rtuId,
        templateId: assets.templateId,
        // `F4.64` — the access check filters on this in memory rather than
        // asking the database once per asset. Free: this row is already read.
        locationId: assets.locationId,
      })
      .from(assets)
      .where(inArray(assets.id, body.assetIds));

    const found = new Set(selected.map((a) => a.id));
    const missing = body.assetIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `These asset ids do not exist: ${missing.join(", ")}. Nothing was written.`,
      );
    }

    // `F4.64` — count the refusals, do not name them. This used to throw on the
    // first one with `Asset "${asset.code}"` in the body, which handed the
    // caller the human-readable code of a row it was simultaneously telling
    // them they may not touch. `asset-templates-instantiate.service.ts` already
    // answered this the other way — it names the codes its caller can see and
    // collapses the rest to a count — so the divergence was this file's, not a
    // missing decision.
    //
    // **The scope resolution is borrowed from that service too, and it is not
    // cosmetic.** Counting means no short-circuit, and the per-asset
    // `canManageAsset` this replaced issues a `users` lookup plus an `assets`
    // lookup plus a `writableLocationIds` resolution *each time*. `assetIds` is
    // capped at 200, so a refused 200-asset batch would have gone from stopping
    // at the first refusal to ~200 sequential round trips — the naming fix
    // would have bought a latency regression on the refusal path. Resolving the
    // writable set **once** and filtering in memory is instead strictly fewer
    // queries than before, on the success path as well.
    //
    // Equivalent to `canManageAsset` by construction, not by resemblance: that
    // method returns true for `admin` before it ever reads the asset (hence the
    // `null` short-circuit here, which must come first), and otherwise resolves
    // the asset's `location_id` and asks `writableLocationIds` whether it is in
    // the set. An asset with no location is refused there and is refused here.
    const writableLocationIds = await this.accessControl.writableLocationIds(jwt);
    const refused =
      writableLocationIds === null
        ? 0
        : selected.filter(
            (asset) =>
              asset.locationId === null || !writableLocationIds.includes(asset.locationId),
          ).length;
    if (refused > 0) {
      const noun = refused === 1 ? "asset" : "assets";
      const verb = refused === 1 ? "is" : "are";
      throw new ForbiddenException(
        `${refused} ${noun} in this batch ${verb} outside your access scope. Nothing was written.`,
      );
    }

    const unpinned = selected.filter((a) => a.templateId === null);
    if (unpinned.length > 0) {
      throw new BadRequestException(
        `These assets were created by hand and are pinned to no template version, so there ` +
          `is nothing to migrate from: ${unpinned.map((a) => a.code).join(", ")}.`,
      );
    }

    const sourceIds = [...new Set(selected.map((a) => a.templateId as string))];
    const sources = await this.fleetDb
      .select()
      .from(assetTemplates)
      .where(inArray(assetTemplates.id, sourceIds));
    const sourceById = new Map(sources.map((row) => [row.id, row]));

    for (const source of sources) {
      if (source.organizationId !== target.organizationId || source.code !== target.code) {
        throw new BadRequestException(
          `Asset(s) pinned to template "${source.code}" v${source.version} cannot be migrated ` +
            `onto "${target.code}" v${target.version}. Migration moves an asset between ` +
            "versions of the SAME template code — a different code is a different piece of " +
            "equipment, not a newer description of this one.",
        );
      }
    }

    // Already on the target version: excluded rather than refused. Re-submitting
    // a migration is the ordinary way this happens.
    const toMigrate = selected.filter((a) => a.templateId !== target.id);

    const targetPoints = await this.loadPoints(target.id);
    const catalogUnits = await this.catalogUnits(targetPoints);

    // Bounded collector — see `MAX_REPORTED_REFUSALS`. The count keeps rising
    // after the list stops, so "is this migration refused" and "how badly" stay
    // true regardless of the cap.
    const refusals: TemplateMigrationRefusalDto[] = [];
    let refusalCount = 0;
    const refuse = (refusal: TemplateMigrationRefusalDto): void => {
      refusalCount += 1;
      if (refusals.length < MAX_REPORTED_REFUSALS) {
        refusals.push(refusal);
      }
    };
    const deltas: TemplateVersionDeltaDto[] = [];
    const planned: PlannedAsset[] = [];

    // One delta per distinct source version — a selection may span several.
    const bySource = new Map<string, typeof toMigrate>();
    for (const asset of toMigrate) {
      const key = asset.templateId as string;
      const list = bySource.get(key);
      if (list) list.push(asset);
      else bySource.set(key, [asset]);
    }

    for (const [sourceId, group] of bySource) {
      const source = sourceById.get(sourceId);
      if (!source) {
        throw new Error(`migrate: no source template row for ${sourceId}`);
      }

      // Q-B, before the delta: a domain change is about the whole version, not
      // about any one point, so it refuses regardless of what the points say.
      if (source.domain !== target.domain) {
        refuse({
          reason: "domain_changed",
          pointKey: null,
          assetCount: group.length,
          message:
            `Version ${source.version} declares domain "${source.domain}" and version ` +
            `${target.version} declares "${target.domain}". A domain change moves assets ` +
            "between plant-domain views, rule categories and dashboards, so it is refused " +
            "rather than applied silently — assets.domain would otherwise disagree with the " +
            "version they are pinned to. Rebuild these assets from the new version instead.",
        });
      }

      const sourcePoints = await this.loadPoints(sourceId);
      const delta = computeTemplateVersionDelta(sourcePoints, targetPoints, {
        fromVersion: source.version,
        toVersion: target.version,
        assetCount: group.length,
      });
      deltas.push(delta);
      for (const refusal of delta.refusals) refuse(refusal);

      for (const asset of group) {
        const newPoints: PlannedAsset["newPoints"] = [];
        const skipped: TemplateMigrationSkippedPointDto[] = [];

        for (const addition of delta.measuredAdded) {
          const resolved = this.resolveSourceDataKey(addition.sourceDataKeyPattern, asset.code);
          if (resolved.ok) {
            if (resolved.sourceDataKey.length > SOURCE_DATA_KEY_MAX) {
              refuse({
                reason: "unresolvable_source_data_key",
                pointKey: addition.pointKey,
                assetCount: 1,
                message:
                  `Asset "${asset.code}": point "${addition.pointKey}" resolves to a source ` +
                  `data key of ${resolved.sourceDataKey.length} characters, over the ` +
                  `${SOURCE_DATA_KEY_MAX} limit.`,
              });
              continue;
            }
            newPoints.push({
              pointKey: addition.pointKey,
              sourceDataKey: resolved.sourceDataKey,
              // Exactly `AssetTemplateInstantiationService.planAsset`'s
              // resolution: the template's unit is an OVERRIDE, and null means
              // "use the catalog's". Decision 4 says these rows are created by
              // the same path instantiation uses, and a migrated row carrying
              // the catalog unit where an instantiated one carries the override
              // is the same point rendering two different units.
              unit: addition.unit ?? catalogUnits.get(addition.pointKey) ?? null,
            });
            continue;
          }

          if (addition.required) {
            // Q-A. Refused before the transaction opens, naming everything the
            // operator needs to act: which point, which asset, and which tokens
            // migration cannot supply.
            refuse({
              reason: "unresolvable_source_data_key",
              pointKey: addition.pointKey,
              assetCount: 1,
              message:
                `Asset "${asset.code}": required point "${addition.pointKey}" has pattern ` +
                `${addition.sourceDataKeyPattern === null ? "(none set)" : `"${addition.sourceDataKeyPattern}"`}` +
                `, and migration cannot resolve ${resolved.unresolved.length > 0 ? `{${resolved.unresolved.join("}, {")}}` : "it"}. ` +
                "Only {asset_code} survives — instantiation takes its other variables per " +
                "request and never stores them, so there is nothing to recover for an asset " +
                "built earlier. Rebuild these assets from the new version instead.",
            });
            continue;
          }
          skipped.push({ assetId: asset.id, assetCode: asset.code, pointKey: addition.pointKey });
        }

        planned.push({
          dto: {
            assetId: asset.id,
            assetCode: asset.code,
            assetName: asset.name,
            fromVersionId: source.id,
            fromVersion: source.version,
          },
          rtuId: asset.rtuId,
          newPoints,
          skipped,
        });
      }
    }

    // Decision 4 creates each measured addition's `asset_points` row, and three
    // unrelated paths may already have created one for the same
    // `(asset_id, point_key)`: a hand-made mapping, `CalcWriteService` on a
    // derived point's first computed value, and — since decision 7 — the calc
    // override endpoint. A version that turns a derived point measured collides
    // with a row the operator does not think of as a mapping at all.
    //
    // `asset_points_asset_id_point_key_unique` would raise 23505 *inside* the
    // transaction: nothing is written, but the operator gets a driver error
    // naming no point and no asset, from a service whose own contract is that
    // every fallible decision is made before the transaction opens. So the
    // collision is read here and refused by name.
    //
    // Refused rather than merged. `onConflictDoNothing` would report the point
    // as created while leaving a `computed` row standing in for physical
    // wiring, which is exactly the quiet wrongness this feature exists to stop.
    //
    // **One read, two checks** (`F2.9` Task 12b). The collision check below
    // needs the assets that create a point; the override re-validation after it
    // needs *every* migrating asset, and the first set is a subset of the
    // second. Two batched reads of one table in one plan would be two round
    // trips for the same rows, so this reads the superset once and both checks
    // filter it in memory. The collision half is unchanged: it still iterates
    // only `asset.newPoints`, so a migration that creates nothing still refuses
    // nothing here.
    const plannedAssetIds = planned.map((a) => a.dto.assetId);
    if (plannedAssetIds.length > 0) {
      // E7.1b: `asset_points` read on `fleetDb` — FORCEd in 0047; a zero-row
      // tenantDb read would make every point look new and plan duplicate
      // inserts. `plannedAssetIds` are the already-scoped selected assets.
      const existingRows = await this.fleetDb
        .select({
          assetId: assetPoints.assetId,
          pointKey: assetPoints.pointKey,
          sourceKind: assetPoints.sourceKind,
          // The five calc override columns — ADR 0039 decision 6's coalesce
          // reads exactly these off this table. There is no
          // `asset_points.min_coverage_ratio` and there must not be one:
          // ADR 0055 decision 11 refuses a per-asset coverage ratio.
          formula: assetPoints.formula,
          formulaDialect: assetPoints.formulaDialect,
          calcTrigger: assetPoints.calcTrigger,
          calcIntervalSeconds: assetPoints.calcIntervalSeconds,
          maxInputAgeSeconds: assetPoints.maxInputAgeSeconds,
        })
        .from(assetPoints)
        .where(inArray(assetPoints.assetId, plannedAssetIds));

      type ExistingPointRow = (typeof existingRows)[number];
      const existingByAsset = new Map<string, Map<string, ExistingPointRow>>();
      for (const row of existingRows) {
        const forAsset = existingByAsset.get(row.assetId) ?? new Map<string, ExistingPointRow>();
        forAsset.set(row.pointKey, row);
        existingByAsset.set(row.assetId, forAsset);
      }

      for (const asset of planned) {
        const forAsset = existingByAsset.get(asset.dto.assetId);
        if (!forAsset) {
          continue;
        }
        for (const point of asset.newPoints) {
          const sourceKind = forAsset.get(point.pointKey)?.sourceKind;
          if (sourceKind === undefined) {
            continue;
          }
          refuse({
            reason: "point_key_already_mapped",
            pointKey: point.pointKey,
            assetCount: 1,
            message:
              `Asset "${asset.dto.assetCode}": version ${target.version} adds ` +
              `"${point.pointKey}" as a measured point, but this asset already has an ` +
              `asset_points row for that key with source_kind "${sourceKind}". ` +
              (sourceKind === "computed"
                ? "That row is calc configuration, and reusing it as telemetry wiring would " +
                  "repoint a formula onto ingest values. "
                : "That row is a telemetry mapping, and it may resolve to a different source " +
                  "than the new version's pattern. ") +
              "Remove or re-key the existing row first, or rebuild this asset from the new " +
              "version.",
          });
        }
      }

      // --- the surviving override, re-validated (`F2.9` Task 12b) ----------
      //
      // Both gates live in `asset-templates-migrate-calc.ts`, whose docblock
      // carries the whole argument: why migrate re-runs the override
      // endpoint's own two checks rather than restating them, and exactly
      // what parity with that endpoint does and does not claim. Called here,
      // before the transaction opens, like every other fallible decision.
      await refuseOverridesThatDoNotSurvive({
        assets: planned
          .filter((asset) => existingByAsset.has(asset.dto.assetId))
          .map((asset) => ({
            assetId: asset.dto.assetId,
            assetCode: asset.dto.assetCode,
            rows: existingByAsset.get(asset.dto.assetId) as Map<string, ExistingPointRow>,
          })),
        targetPoints,
        // Read only when some migrating asset actually carries a `computed`
        // row. Most migrations have no override at all, and this service does
        // not resolve what it does not need before the transaction. The empty
        // map is not a silent skip: the gate treats a missing id as "cannot
        // build a candidate node" and there is nothing to check anyway.
        targetPointIdsByKey: existingRows.some((row) => row.sourceKind === "computed")
          ? await this.pointIdsByKey(target.id)
          : new Map<string, string>(),
        targetVersion: target.version,
        dependencies: this.dependencies,
        refuse,
      });
    }

    return {
      target,
      planned,
      deltas,
      refusals,
      refusalCount,
      fromVersions: [...new Set(planned.map((a) => a.dto.fromVersion))].sort((a, b) => a - b),
    };
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

  /**
   * `template_points.id` by point key, for one version.
   *
   * A second, narrow read rather than a column on {@link loadPoints}: that
   * projection is "the subset of a stored row `computeTemplateVersionDelta`
   * reads", and the id is not one of them — widening it would put a field on
   * the delta's input type that the delta never looks at. Read once per plan,
   * on the same `fleetDb` and for the same E7.1b reason as every other
   * `template_points` read here.
   */
  private async pointIdsByKey(templateId: string): Promise<Map<string, string>> {
    const rows = await this.fleetDb
      .select({ id: templatePoints.id, pointKey: templatePoints.pointKey })
      .from(templatePoints)
      .where(eq(templatePoints.templateId, templateId));
    return new Map(rows.map((row) => [row.pointKey, row.id]));
  }

  private async loadPoints(templateId: string): Promise<StoredTemplatePoint[]> {
    // E7.1b: `template_points` read on `fleetDb` — a `FORCE`d tenant table in
    // `0047`. The delta this feeds decides what to migrate; a silent zero-point
    // read would compute an empty delta and migrate nothing.
    const rows = await this.fleetDb
      .select()
      .from(templatePoints)
      .where(eq(templatePoints.templateId, templateId))
      .orderBy(asc(templatePoints.sortOrder), asc(templatePoints.pointKey));
    return rows.map((row) => ({
      pointKey: row.pointKey,
      kind: row.kind,
      sourceDataKeyPattern: row.sourceDataKeyPattern,
      required: row.required,
      unit: row.unit,
      formula: row.formula,
      formulaDialect: row.formulaDialect,
      calcTrigger: row.calcTrigger,
      calcIntervalSeconds: row.calcIntervalSeconds,
      maxInputAgeSeconds: row.maxInputAgeSeconds,
      // `F2.9` finding 31. Projected because the delta compares it: a version
      // bump that moves only the ratio used to produce an empty
      // `derivedChanged`, so `migration-preview` said "no changes" while the
      // migrated asset picked the new value up on its next sweep.
      minCoverageRatio: row.minCoverageRatio,
    }));
  }

  /**
   * Catalog units for the target version's point keys.
   *
   * Unlike instantiation this does **not** refuse a key that has left the
   * active catalog. Instantiation is creating equipment and can insist the
   * catalog is current; a migration is moving equipment that already exists,
   * and refusing it because an unrelated key was deactivated would strand the
   * estate on an old version for a reason the operator cannot fix from here.
   * A missing unit falls back to null, which is what the column already means.
   */
  private async catalogUnits(
    points: StoredTemplatePoint[],
  ): Promise<Map<string, string | null>> {
    const codes = [...new Set(points.map((p) => p.pointKey))];
    if (codes.length === 0) {
      return new Map();
    }
    const rows = await this.fleetDb
      .select({ code: pointKeys.code, unit: pointKeys.unit })
      .from(pointKeys)
      // `F3.39`: fleet-wide catalog, so the lookup is by code alone.
      .where(inArray(pointKeys.code, codes));
    return new Map(rows.map((row) => [row.code, row.unit]));
  }

  /**
   * Substitutes `{token}`s using only `{asset_code}` — Q-A's ruling.
   *
   * Returns the unresolved token names rather than just failing, because
   * "migration cannot resolve {panel}" is actionable and "the pattern did not
   * resolve" is not. Never returns a partially substituted key: a
   * plausible-looking string pointing at nothing is the failure
   * `AssetTemplateInstantiationService.resolveSourceDataKey` also refuses to
   * produce.
   */
  private resolveSourceDataKey(
    pattern: string | null,
    assetCode: string,
  ): { ok: true; sourceDataKey: string } | { ok: false; unresolved: string[] } {
    if (!pattern) {
      return { ok: false, unresolved: [] };
    }
    const unresolved: string[] = [];
    const resolved = pattern.replace(PATTERN_TOKEN, (_match, name: string) => {
      if (name === MIGRATION_RESOLVABLE_VAR) {
        return assetCode;
      }
      unresolved.push(name);
      return "";
    });
    if (unresolved.length > 0 || resolved.length === 0) {
      return { ok: false, unresolved: [...new Set(unresolved)] };
    }
    return { ok: true, sourceDataKey: resolved };
  }
}
