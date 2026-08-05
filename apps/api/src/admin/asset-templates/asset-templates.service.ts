import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { assetTemplates, organizations, pointKeys, templatePoints, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AdminAssetTemplateDto,
  AdminAssetTemplateSummaryDto,
  AdminTemplatePointDto,
  AssetTemplateStatus,
  JwtPayload,
  TemplatePointKind,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type {
  CreateAssetTemplateBody,
  TemplatePointBody,
  UpdateAssetTemplateBody,
} from "./asset-templates.schema";

/**
 * The template **version lifecycle** (ADR 0015 §5). Instantiation — building
 * assets from a published version — lives in
 * `AssetTemplateInstantiationService`; it is the only operation in this module
 * that writes outside `asset_templates`/`template_points`.
 */

type TemplateRow = typeof assetTemplates.$inferSelect;
type PointRow = typeof templatePoints.$inferSelect;

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
