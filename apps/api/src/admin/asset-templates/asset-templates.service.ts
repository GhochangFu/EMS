import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import {
  assetPoints,
  assetTemplates,
  assets,
  locations,
  organizations,
  pointKeys,
  rtus,
  templatePoints,
  users,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AdminAssetTemplateDto,
  AdminAssetTemplateSummaryDto,
  AdminTemplatePointDto,
  AssetInstantiationResultDto,
  AssetTemplateStatus,
  JwtPayload,
  TemplatePointKind,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type {
  CreateAssetTemplateBody,
  InstantiateAssetBody,
  InstantiateAssetsBody,
  TemplatePointBody,
  UpdateAssetTemplateBody,
} from "./asset-templates.schema";

type TemplateRow = typeof assetTemplates.$inferSelect;
type PointRow = typeof templatePoints.$inferSelect;

/**
 * Always substituted from the asset's own `code`, never from
 * `sourceDataKeyVars`. Letting a caller override it would let two assets in one
 * batch resolve to the same `source_data_key` while carrying different codes —
 * silently aliasing two pieces of equipment onto one telemetry stream.
 */
const INSTANTIATE_RESERVED_VAR = "asset_code";

/** `{token}` in a `source_data_key_pattern`. */
const PATTERN_TOKEN = /\{([a-zA-Z0-9_]+)\}/g;

/** `bms.asset_points.source_data_key` is `varchar(128)`. */
const SOURCE_DATA_KEY_MAX = 128;

/** The resolved target of an instantiate call — an RTU implies its location. */
type InstantiationTarget = {
  locationId: string;
  locationName: string;
  organizationId: string;
  rtuId: string | null;
};

/** One asset's plan, computed before anything is written. */
type AssetPlan = {
  entry: InstantiateAssetBody;
  points: { pointKey: string; sourceDataKey: string; unit: string | null }[];
  skippedPoints: string[];
};

@Injectable()
export class AssetTemplatesAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists template versions visible to the caller, newest version first. */
  async list(
    jwt: JwtPayload,
    organizationId?: string,
    status?: AssetTemplateStatus,
  ): Promise<{ items: AdminAssetTemplateSummaryDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableOrgIds = await this.accessControl.writableOrganizationIds(jwt);

    const conditions = [];
    if (organizationId) {
      if (!(await this.accessControl.canManageOrganization(jwt, organizationId))) {
        throw new ForbiddenException("Organization is outside your access scope");
      }
      conditions.push(eq(assetTemplates.organizationId, organizationId));
    } else if (writableOrgIds !== null) {
      // `null` is the unrestricted sentinel; an empty array is a real user with
      // no grants, and must see nothing rather than everything.
      if (writableOrgIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(assetTemplates.organizationId, writableOrgIds));
    }
    if (status) {
      conditions.push(eq(assetTemplates.status, status));
    }

    const rows = await this.db
      .select({
        template: assetTemplates,
        organizationCode: organizations.code,
        organizationName: organizations.name,
        pointCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${templatePoints}
           WHERE ${templatePoints.templateId} = ${assetTemplates.id}
        )`,
      })
      .from(assetTemplates)
      .innerJoin(organizations, eq(assetTemplates.organizationId, organizations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(assetTemplates.code), desc(assetTemplates.version));

    return {
      items: rows.map((row) => ({
        ...this.mapTemplate(row.template, row.organizationCode, row.organizationName),
        pointCount: row.pointCount,
      })),
    };
  }

  /** Returns one template version with its points. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminAssetTemplateDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    const { template, organizationCode, organizationName } = await this.fetchRow(id);
    if (!(await this.accessControl.canManageOrganization(jwt, template.organizationId))) {
      throw new ForbiddenException("Template is outside your access scope");
    }
    return this.withPoints(template, organizationCode, organizationName);
  }

  /**
   * Creates a new draft version of `code`, at `max(version) + 1`.
   *
   * A brand-new code starts at 1. Version numbers are monotonic but may have
   * gaps: an abandoned and deleted draft consumes its number permanently, and
   * renumbering would break the only thing a pin guarantees.
   */
  async create(
    jwt: JwtPayload,
    body: CreateAssetTemplateBody,
  ): Promise<AdminAssetTemplateDto> {
    await this.assertCanAuthor(jwt, body.organizationId);
    await this.assertPointKeysActive(body.organizationId, body.points);
    const createdBy = await this.resolveCreatedBy(jwt);

    const created = await this.db.transaction(async (tx) => {
      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql<number | null>`MAX(${assetTemplates.version})` })
        .from(assetTemplates)
        .where(
          and(
            eq(assetTemplates.organizationId, body.organizationId),
            eq(assetTemplates.code, body.code),
          ),
        );

      const [row] = await tx
        .insert(assetTemplates)
        .values({
          organizationId: body.organizationId,
          code: body.code,
          version: (maxVersion ?? 0) + 1,
          name: body.name,
          assetType: body.assetType,
          domain: body.domain,
          description: body.description ?? null,
          status: "draft",
          content: body.content ?? {},
          createdBy,
        })
        .returning();

      await this.replacePoints(tx, row.id, body.points);
      return row;
    }).catch((err: unknown) => {
      throw this.translateDraftConflict(err, body.code);
    });

    await this.audit.write({
      actor: jwt,
      action: "master.asset_template.create",
      entityType: "asset_template",
      entityId: created.id,
      payload: { code: body.code, version: created.version, points: body.points.length },
    });
    return this.getById(jwt, created.id);
  }

  /**
   * Edits a draft. Published versions are immutable — that is the ADR's central
   * decision, not a permission check: instantiated `asset_points` rows are
   * physical wiring that `apps/ingest` and the rule engine read, so a template
   * edit must never reach assets already built from it. Use `createDraftFrom`.
   */
  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdateAssetTemplateBody,
  ): Promise<AdminAssetTemplateDto> {
    const { template } = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    this.assertDraft(template, "edited");

    if (body.points) {
      await this.assertPointKeysActive(template.organizationId, body.points);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(assetTemplates)
        .set({
          name: body.name ?? template.name,
          assetType: body.assetType ?? template.assetType,
          domain: body.domain ?? template.domain,
          description:
            body.description !== undefined ? (body.description ?? null) : template.description,
          content: body.content ?? (template.content as Record<string, unknown>),
          updatedAt: new Date(),
        })
        .where(eq(assetTemplates.id, id));

      if (body.points) {
        await this.replacePoints(tx, id, body.points);
      }
    });

    await this.audit.write({
      actor: jwt,
      action: "master.asset_template.update",
      entityType: "asset_template",
      entityId: id,
      payload: { ...body, points: body.points?.length },
    });
    return this.getById(jwt, id);
  }

  /**
   * Publishes a draft, freezing it.
   *
   * Point keys are re-validated here even though `create`/`update` already did:
   * ADR 0010 §5 requires an *active* catalog row, and a key can be deactivated
   * between authoring and publishing. Failing at publish is recoverable;
   * failing later, mid-instantiation across 40 assets, is not.
   */
  async publish(jwt: JwtPayload, id: string): Promise<AdminAssetTemplateDto> {
    const { template } = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    this.assertDraft(template, "published");

    const points = await this.db
      .select()
      .from(templatePoints)
      .where(eq(templatePoints.templateId, id));
    if (points.length === 0) {
      throw new BadRequestException(
        "A template with no points would instantiate assets with no telemetry mapping",
      );
    }
    await this.assertPointKeysActive(template.organizationId, points);

    const now = new Date();
    await this.db
      .update(assetTemplates)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(eq(assetTemplates.id, id));

    await this.audit.write({
      actor: jwt,
      action: "master.asset_template.publish",
      entityType: "asset_template",
      entityId: id,
      payload: { code: template.code, version: template.version },
    });
    return this.getById(jwt, id);
  }

  /**
   * Archives a published version.
   *
   * Permitted even while assets pin it, deviating from ADR 0009's "block if
   * children remain" rule and intentionally: ADR 0009 blocks deactivation to
   * avoid orphaning live operational rows, but an instantiated asset owns its
   * own `asset_points` and keeps working untouched. Archiving only removes the
   * version from the "instantiate from" picker.
   */
  async archive(jwt: JwtPayload, id: string): Promise<AdminAssetTemplateDto> {
    const { template } = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    if (template.status !== "published") {
      throw new ConflictException(
        `Only a published template can be archived; this one is ${template.status}`,
      );
    }

    const now = new Date();
    await this.db
      .update(assetTemplates)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(eq(assetTemplates.id, id));

    await this.audit.write({
      actor: jwt,
      action: "master.asset_template.archive",
      entityType: "asset_template",
      entityId: id,
      payload: { code: template.code, version: template.version },
    });
    return this.getById(jwt, id);
  }

  /**
   * "Edit a published template" — creates the next draft, seeded by copying
   * this version's rows. The partial unique index guarantees at most one draft
   * per `(organization_id, code)` exists at a time, so a second concurrent
   * click fails at the database rather than producing two rival drafts.
   */
  async createDraftFrom(jwt: JwtPayload, id: string): Promise<AdminAssetTemplateDto> {
    const { template } = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);

    const source = await this.db
      .select()
      .from(templatePoints)
      .where(eq(templatePoints.templateId, id))
      .orderBy(asc(templatePoints.sortOrder));
    const createdBy = await this.resolveCreatedBy(jwt);

    const draft = await this.db.transaction(async (tx) => {
      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql<number | null>`MAX(${assetTemplates.version})` })
        .from(assetTemplates)
        .where(
          and(
            eq(assetTemplates.organizationId, template.organizationId),
            eq(assetTemplates.code, template.code),
          ),
        );

      const [row] = await tx
        .insert(assetTemplates)
        .values({
          organizationId: template.organizationId,
          code: template.code,
          version: (maxVersion ?? 0) + 1,
          name: template.name,
          assetType: template.assetType,
          domain: template.domain,
          description: template.description,
          status: "draft",
          content: template.content as Record<string, unknown>,
          createdBy,
        })
        .returning();

      await this.replacePoints(tx, row.id, source);
      return row;
    }).catch((err: unknown) => {
      throw this.translateDraftConflict(err, template.code);
    });

    await this.audit.write({
      actor: jwt,
      action: "master.asset_template.draft",
      entityType: "asset_template",
      entityId: draft.id,
      payload: { code: template.code, fromVersion: template.version, version: draft.version },
    });
    return this.getById(jwt, draft.id);
  }

  /**
   * Deletes a draft. The sole hard delete permitted anywhere in this design,
   * and safe by construction: nothing can pin an unpublished version, so a
   * draft has no dependents. Everything else follows ADR 0009's no-hard-delete
   * rule — a published version must stay resolvable forever, because an asset's
   * pin points at it.
   */
  async deleteDraft(jwt: JwtPayload, id: string): Promise<{ deleted: true }> {
    const { template } = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    this.assertDraft(template, "deleted");

    // template_points cascade on the FK.
    await this.db.delete(assetTemplates).where(eq(assetTemplates.id, id));

    await this.audit.write({
      actor: jwt,
      action: "master.asset_template.delete_draft",
      entityType: "asset_template",
      entityId: id,
      payload: { code: template.code, version: template.version },
    });
    return { deleted: true };
  }

  /**
   * Builds assets from a published template — model-once-deploy-many
   * (`F2.2`, ADR 0015 §6 as amended 2026-08-05).
   *
   * All-or-nothing by construction. Every fallible decision — target
   * resolution, org match, access, catalog validity, code collisions, pattern
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
    const { template } = await this.fetchRow(templateId);

    if (template.status !== "published") {
      throw new ConflictException(
        `Only a published template can be instantiated; this one is ${template.status}. ` +
          "Publishing is what freezes the shape assets are built from.",
      );
    }

    const target = await this.resolveTarget(body);
    if (target.organizationId !== template.organizationId) {
      throw new BadRequestException(
        "Template belongs to a different organization than the target. A template may not " +
          "cross org boundaries — its point keys resolve against its own organization's catalog.",
      );
    }

    // ADR 0015 §7 as amended: *readability* on the template's org, not
    // `canManageTemplate`. `canManageTemplate` means "may author", and is false
    // for location_admin by design — requiring it here would deny the one role
    // §7 exists to allow, making model-once-deploy-many unreachable for a
    // multi-site client. Authoring stays closed; deploying opens.
    if (!(await this.accessControl.canManageOrganization(jwt, template.organizationId))) {
      throw new ForbiddenException("Template is outside your access scope");
    }
    if (!(await this.accessControl.canManageLocation(jwt, target.locationId))) {
      throw new ForbiddenException("Target location is outside your access scope");
    }

    const points = await this.db
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
    const catalogUnits = await this.assertCatalogActiveForInstantiation(
      template.organizationId,
      points,
      template,
    );
    const measured = points.filter((point) => point.kind === "measured");

    await this.assertAssetCodesFree(body.assets);
    const plans = body.assets.map((entry) => this.planAsset(entry, measured, catalogUnits));

    const sourceKind = target.rtuId ? "measured" : "unmapped";
    const created = await this.db
      .transaction(async (tx) => {
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
        return { idByCode, pointCount: pointValues.length };
      })
      .catch((err: unknown) => {
        throw this.translateAssetCodeCollision(err);
      });

    const assetDtos = plans.map((plan) => ({
      id: created.idByCode.get(plan.entry.code) as string,
      code: plan.entry.code,
      name: plan.entry.name,
      locationId: target.locationId,
      rtuId: target.rtuId,
      pointCount: plan.points.length,
      skippedPoints: plan.skippedPoints,
    }));

    await this.audit.write({
      actor: jwt,
      action: "master.asset.instantiate",
      entityType: "asset_template",
      entityId: template.id,
      payload: {
        templateCode: template.code,
        templateVersion: template.version,
        locationId: target.locationId,
        rtuId: target.rtuId,
        assetIds: assetDtos.map((asset) => asset.id),
        pointCount: created.pointCount,
      },
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
    };
  }

  /**
   * Resolves `rtuId` **or** `locationId` to one target.
   *
   * The Zod contract guarantees exactly one is set; this trusts that and does
   * not re-derive it. An RTU supplies its own location, which is why the two
   * are mutually exclusive rather than combinable.
   */
  private async resolveTarget(body: InstantiateAssetsBody): Promise<InstantiationTarget> {
    if (body.rtuId) {
      const [row] = await this.db
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
        .where(eq(rtus.id, body.rtuId))
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

    const [row] = await this.db
      .select({
        locationId: locations.id,
        locationName: locations.name,
        organizationId: locations.organizationId,
        active: locations.active,
      })
      .from(locations)
      .where(eq(locations.id, body.locationId as string))
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
      rtuId: null,
    };
  }

  /**
   * Re-validates every point key against the org's **active** catalog and
   * returns the catalog units, in one query.
   *
   * ADR 0015 §3 says to re-validate "through the same path
   * `resolveCatalogPointKey` already uses". Applied literally to 40 assets ×
   * 12 points that is 480 identical single-row queries; this issues one with
   * the same three predicates and the same unit fallback (Amendment 1C). The
   * error names the template version, because a caller told only "inactive
   * point key" cannot tell whether to fix the catalog or the template.
   */
  private async assertCatalogActiveForInstantiation(
    organizationId: string,
    points: PointRow[],
    template: TemplateRow,
  ): Promise<Map<string, string | null>> {
    const codes = [...new Set(points.map((point) => point.pointKey))];
    const rows = await this.db
      .select({ code: pointKeys.code, unit: pointKeys.unit })
      .from(pointKeys)
      .where(
        and(
          eq(pointKeys.organizationId, organizationId),
          eq(pointKeys.active, true),
          inArray(pointKeys.code, codes),
        ),
      );

    const units = new Map(rows.map((row) => [row.code, row.unit]));
    const missing = codes.filter((code) => !units.has(code));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot instantiate ${template.code} v${template.version}: these point keys are no ` +
          `longer in the organization's active catalog: ${missing.join(", ")}. ` +
          "Reactivate them, or publish a new template version without them.",
      );
    }
    return units;
  }

  /**
   * Fails before writing anything when a code is already taken.
   *
   * `bms.assets.code` is *globally* unique, not per-location (ADR 0015 §6), so
   * without this a collision on asset 39 rolls back all 40 and reports a
   * constraint name. The transaction still translates the constraint as a
   * backstop for the race this cannot close.
   */
  private async assertAssetCodesFree(entries: InstantiateAssetBody[]): Promise<void> {
    const codes = entries.map((entry) => entry.code);
    const taken = await this.db
      .select({ code: assets.code })
      .from(assets)
      .where(inArray(assets.code, codes));
    if (taken.length > 0) {
      throw new ConflictException(
        `These asset codes already exist: ${taken.map((row) => row.code).join(", ")}. ` +
          "Asset codes are globally unique, not per location.",
      );
    }
  }

  /**
   * Computes one asset's point rows, or throws.
   *
   * A **required** measured point that resolves to no key aborts the batch —
   * `source_data_key` is `NOT NULL` and a placeholder would be a lie that
   * `apps/ingest` later reads as wiring (§6 step 6). An explicitly **optional**
   * one is skipped and reported, which is the only other honest option.
   */
  private planAsset(
    entry: InstantiateAssetBody,
    measured: PointRow[],
    catalogUnits: Map<string, string | null>,
  ): AssetPlan {
    const points: AssetPlan["points"] = [];
    const skippedPoints: string[] = [];

    for (const point of measured) {
      const sourceDataKey = this.resolveSourceDataKey(point, entry);
      if (sourceDataKey === null) {
        if (point.required) {
          throw new BadRequestException(
            `Asset "${entry.code}": required point "${point.pointKey}" has no resolvable ` +
              `source data key. Pattern: ${point.sourceDataKeyPattern ?? "(none set)"}; ` +
              `variables supplied: ${Object.keys(entry.sourceDataKeyVars ?? {}).join(", ") || "(none)"}.`,
          );
        }
        skippedPoints.push(point.pointKey);
        continue;
      }
      if (sourceDataKey.length > SOURCE_DATA_KEY_MAX) {
        throw new BadRequestException(
          `Asset "${entry.code}": point "${point.pointKey}" resolved to a source data key of ` +
            `${sourceDataKey.length} characters, over the ${SOURCE_DATA_KEY_MAX} limit.`,
        );
      }
      points.push({
        pointKey: point.pointKey,
        sourceDataKey,
        // The template's unit is an *override*; null means "use the catalog's",
        // which is exactly what `resolveCatalogPointKey` returns as its fallback.
        unit: point.unit ?? catalogUnits.get(point.pointKey) ?? null,
      });
    }

    return { entry, points, skippedPoints };
  }

  /**
   * Substitutes `{token}`s in a point's pattern. Returns `null` when the point
   * has no pattern or any token is unsupplied — never a partially substituted
   * key, which would be a plausible-looking string pointing at nothing.
   */
  private resolveSourceDataKey(point: PointRow, entry: InstantiateAssetBody): string | null {
    const pattern = point.sourceDataKeyPattern;
    if (!pattern) {
      return null;
    }
    const vars: Record<string, string> = {
      ...(entry.sourceDataKeyVars ?? {}),
      [INSTANTIATE_RESERVED_VAR]: entry.code,
    };

    let unresolved = false;
    const resolved = pattern.replace(PATTERN_TOKEN, (_match, name: string) => {
      const value = vars[name];
      if (value === undefined) {
        unresolved = true;
        return "";
      }
      return value;
    });
    return unresolved || resolved.length === 0 ? null : resolved;
  }

  /** Backstop for a code taken between the pre-check and the insert. */
  private translateAssetCodeCollision(err: unknown): unknown {
    const constraint = (err as { constraint?: string } | null)?.constraint;
    if (constraint === "assets_code_unique") {
      return new ConflictException(
        "An asset code in this batch was taken while the batch was being created. " +
          "Nothing was written — retry with fresh codes.",
      );
    }
    return err;
  }

  /**
   * Resolves the actor to a real `bms.users.id`, or `null`.
   *
   * `jwt.sub` is NOT a `bms.users.id` in OIDC mode — it is Keycloak's subject,
   * which has no row here. Writing it into `created_by` violates
   * `asset_templates_created_by_fkey` and 500s every create for exactly the
   * users the pilot authenticates. `MasterDataAuditService.write` already
   * resolves by id-or-email and falls back to null; this does the same, which
   * is why the column is nullable.
   */
  private async resolveCreatedBy(jwt: JwtPayload): Promise<string | null> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
      .limit(1);
    return row?.id ?? null;
  }

  /** Author permission: org-scoped, `location_admin` excluded (ADR 0015 §7). */
  private async assertCanAuthor(jwt: JwtPayload, organizationId: string): Promise<void> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role === "location_admin") {
      throw new ForbiddenException("Location admins cannot author asset templates");
    }
    if (!(await this.accessControl.canManageTemplate(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
  }

  private assertDraft(template: TemplateRow, verb: string): void {
    if (template.status !== "draft") {
      throw new ConflictException(
        `A ${template.status} template cannot be ${verb}. Create a new draft version instead — ` +
          "published versions are immutable so that assets built from them never change.",
      );
    }
  }

  /**
   * Every point key must resolve to an **active** row in the org's catalog
   * (ADR 0010 §5), and the error names every offending code.
   *
   * Naming them matters: instantiation re-validates through the same rule, and
   * a caller told only "invalid point key" has to bisect a 40-point template by
   * hand to find which one was deactivated.
   */
  private async assertPointKeysActive(
    organizationId: string,
    points: { pointKey: string }[],
  ): Promise<void> {
    if (points.length === 0) {
      return;
    }
    const codes = [...new Set(points.map((point) => point.pointKey))];
    const rows = await this.db
      .select({ code: pointKeys.code })
      .from(pointKeys)
      .where(
        and(
          eq(pointKeys.organizationId, organizationId),
          eq(pointKeys.active, true),
          inArray(pointKeys.code, codes),
        ),
      );

    const active = new Set(rows.map((row) => row.code));
    const missing = codes.filter((code) => !active.has(code));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Not in this organization's active point-key catalog: ${missing.join(", ")}`,
      );
    }
  }

  /**
   * Replaces a draft's point set wholesale.
   *
   * Delete-then-insert rather than a diff: `template_points` rows have no
   * dependents (nothing references them — instantiation *copies* them into
   * `asset_points`), so preserving their ids buys nothing, and a diff would
   * need to decide what a changed `pointKey` means. Only ever runs against a
   * draft, enforced by the callers.
   */
  private async replacePoints(
    tx: Parameters<Parameters<BmsDb["transaction"]>[0]>[0],
    templateId: string,
    points: (TemplatePointBody | PointRow)[],
  ): Promise<void> {
    await tx.delete(templatePoints).where(eq(templatePoints.templateId, templateId));
    if (points.length === 0) {
      return;
    }
    await tx.insert(templatePoints).values(
      points.map((point, index) => ({
        templateId,
        pointKey: point.pointKey,
        label: point.label ?? null,
        unit: point.unit ?? null,
        kind: point.kind ?? "measured",
        sourceDataKeyPattern: point.sourceDataKeyPattern ?? null,
        required: point.required ?? true,
        sortOrder: point.sortOrder ?? index,
      })),
    );
  }

  /**
   * Turns the partial unique index violation into an answer.
   *
   * `asset_templates_org_code_draft_unique` is what stops two rival drafts, and
   * it fires on a perfectly ordinary user action — clicking "edit" twice, or
   * two admins editing the same template. Surfacing the raw constraint name
   * would read as a bug rather than as "someone already has a draft open".
   */
  private translateDraftConflict(err: unknown, code: string): unknown {
    const constraint = (err as { constraint?: string } | null)?.constraint;
    if (constraint === "asset_templates_org_code_draft_unique") {
      return new ConflictException(
        `Template "${code}" already has an open draft. Publish or delete it before creating another.`,
      );
    }
    return err;
  }

  private async fetchRow(id: string): Promise<{
    template: TemplateRow;
    organizationCode: string;
    organizationName: string;
  }> {
    const [row] = await this.db
      .select({
        template: assetTemplates,
        organizationCode: organizations.code,
        organizationName: organizations.name,
      })
      .from(assetTemplates)
      .innerJoin(organizations, eq(assetTemplates.organizationId, organizations.id))
      .where(eq(assetTemplates.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset template not found");
    }
    return row;
  }

  private async withPoints(
    template: TemplateRow,
    organizationCode: string,
    organizationName: string,
  ): Promise<AdminAssetTemplateDto> {
    const points = await this.db
      .select()
      .from(templatePoints)
      .where(eq(templatePoints.templateId, template.id))
      .orderBy(asc(templatePoints.sortOrder), asc(templatePoints.pointKey));
    return {
      ...this.mapTemplate(template, organizationCode, organizationName),
      points: points.map((point) => this.mapPoint(point)),
    };
  }

  private mapTemplate(
    template: TemplateRow,
    organizationCode: string,
    organizationName: string,
  ): Omit<AdminAssetTemplateDto, "points"> {
    return {
      id: template.id,
      organizationId: template.organizationId,
      organizationCode,
      organizationName,
      code: template.code,
      version: template.version,
      name: template.name,
      assetType: template.assetType,
      domain: template.domain,
      description: template.description,
      status: template.status as AssetTemplateStatus,
      content: (template.content ?? {}) as Record<string, unknown>,
      publishedAt: template.publishedAt?.toISOString() ?? null,
      archivedAt: template.archivedAt?.toISOString() ?? null,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }

  private mapPoint(point: PointRow): AdminTemplatePointDto {
    return {
      id: point.id,
      templateId: point.templateId,
      pointKey: point.pointKey,
      label: point.label,
      unit: point.unit,
      kind: point.kind as TemplatePointKind,
      sourceDataKeyPattern: point.sourceDataKeyPattern,
      required: point.required,
      sortOrder: point.sortOrder,
      createdAt: point.createdAt.toISOString(),
    };
  }
}
