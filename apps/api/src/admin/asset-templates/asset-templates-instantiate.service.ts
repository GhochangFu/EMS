import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  assetPoints,
  assetTemplates,
  assets,
  locations,
  organizations,
  pointKeys,
  rtus,
  templatePoints,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AssetInstantiationResultDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type {
  InstantiateAssetBody,
  InstantiateAssetsBody,
  InstantiationTargetInput,
} from "./asset-templates.schema";

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

/**
 * Ceiling on `asset_points` rows per call.
 *
 * Postgres caps a statement at 65,535 bind parameters. The point insert binds
 * 7 columns per row, so a single statement fails above ~9,360 rows — and the
 * Zod contract permits 200 assets × 500 template points = 100,000. Without
 * this bound a legitimately large batch returns a raw driver error instead of
 * a domain one. Set well under the hard limit so the message stays the thing
 * the caller sees.
 */
const MAX_POINT_ROWS = 8_000;

/** The resolved target — an RTU implies its location. */
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

/**
 * `F4.16` / ADR 0043 — `asset_templates`, `locations` and `point_keys` carry
 * `ENABLE ROW LEVEL SECURITY` (migration `0040`); the reads against them here
 * (`fetchTemplate`, `resolveTarget`, `assertCatalogActive`) run on `fleetDb`,
 * trusting the scope filter this service already applies via
 * `canManageOrganization`/`canManageLocation`. The write transaction inserts
 * only into `assets` and `asset_points`, neither of which carry a policy, so
 * it stays a plain `tenantDb.transaction()` — no `withTenant` is needed
 * because RLS is not in play for either table.
 */
@Injectable()
export class AssetTemplateInstantiationService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
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

    const points = await this.tenantDb
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
    const catalogUnits = await this.assertCatalogActive(template.organizationId, points, template);
    const measured = points.filter((point) => point.kind === "measured");
    this.assertBatchFits(body.assets.length, measured.length);

    await this.assertAssetCodesFree(jwt, body.assets);
    const plans = body.assets.map((entry) => this.planAsset(entry, measured, catalogUnits));

    const sourceKind = target.rtuId ? "measured" : "unmapped";
    const created = await this.tenantDb
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
      };
    });

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
  private async assertCatalogActive(
    organizationId: string,
    points: PointRow[],
    template: TemplateRow,
  ): Promise<Map<string, string | null>> {
    const codes = [...new Set(points.map((point) => point.pointKey))];
    const rows = await this.fleetDb
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

  /** Keeps one statement under the Postgres bind-parameter ceiling. */
  private assertBatchFits(assetCount: number, measuredCount: number): void {
    const rows = assetCount * measuredCount;
    if (rows > MAX_POINT_ROWS) {
      throw new BadRequestException(
        `This batch would create ${rows} asset points (${assetCount} assets × ` +
          `${measuredCount} measured points), over the ${MAX_POINT_ROWS} limit for one call. ` +
          "Split it into smaller batches.",
      );
    }
  }

  /**
   * Fails before writing anything when a code is already taken.
   *
   * `bms.assets.code` is *globally* unique, not per-location (ADR 0015 §6), so
   * without this a collision on asset 39 rolls back all 40 and reports a
   * constraint name.
   *
   * The disclosure is deliberately scoped. A global `WHERE code IN (...)` that
   * echoes every hit turns this into a cross-tenant existence oracle: a caller
   * could submit 200 guessable codes per call and learn which exist anywhere in
   * the deployment, including other organizations' equipment — and because this
   * runs before the transaction, the probe writes nothing and raises no audit
   * row. So codes inside the caller's own writable scope are named (that is the
   * useful, ADR-mandated part) and any others are reported only as a count.
   */
  private async assertAssetCodesFree(
    jwt: JwtPayload,
    entries: InstantiateAssetBody[],
  ): Promise<void> {
    const codes = entries.map((entry) => entry.code);
    const taken = await this.tenantDb
      .select({ code: assets.code, locationId: assets.locationId })
      .from(assets)
      .where(inArray(assets.code, codes));
    if (taken.length === 0) {
      return;
    }

    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const visible = taken.filter(
      (row) => writableIds === null || writableIds.includes(row.locationId),
    );
    const hidden = taken.length - visible.length;

    const parts: string[] = [];
    if (visible.length > 0) {
      parts.push(`already exist: ${visible.map((row) => row.code).join(", ")}`);
    }
    if (hidden > 0) {
      parts.push(
        `${hidden} more are already in use outside your access scope (codes are globally unique)`,
      );
    }
    throw new ConflictException(
      `Cannot create these assets — ${parts.join("; ")}. ` +
        "Asset codes are globally unique, not per location.",
    );
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
   *
   * `vars` is prototype-free on purpose. A plain object literal resolves
   * inherited members, so a pattern containing `{constructor}` or `{toString}`
   * would find a value, skip the unresolved branch, and stringify a function
   * into `source_data_key` — defeating exactly the guarantee above.
   */
  private resolveSourceDataKey(point: PointRow, entry: InstantiateAssetBody): string | null {
    const pattern = point.sourceDataKeyPattern;
    if (!pattern) {
      return null;
    }
    const vars = Object.assign(Object.create(null) as Record<string, string>, {
      ...(entry.sourceDataKeyVars ?? {}),
      [INSTANTIATE_RESERVED_VAR]: entry.code,
    });

    let unresolved = false;
    const resolved = pattern.replace(PATTERN_TOKEN, (_match, name: string) => {
      const value = vars[name];
      if (typeof value !== "string") {
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
}
