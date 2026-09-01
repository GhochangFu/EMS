import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { dashboardSections, dashboardTemplates, organizations, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
// ADR 0049 decision 2 — one declaration of the template lifecycle, shared with
// `asset-templates.service.ts`. `tests/f3.36-template-lifecycle-single-source.test.ts`
// fails the build if this file compares `status` to a literal instead.
import {
  archiveRefusedMessage,
  branchRefusedMessage,
  canMutate,
  canOpenDraftFrom,
  canTransition,
  dashboardTemplateDtoSchema,
  draftRequiredMessage,
  MAX_DASHBOARD_WIDGETS,
  METRIC_CATALOG,
  sectionTemplateContentSchema,
} from "@bms/shared";
import type {
  DashboardTemplateDto,
  DashboardTemplateSummaryDto,
  JwtPayload,
  SectionTemplateContent,
  TemplateDraftRequiredVerb,
  TemplateLifecycleStatus,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { METRIC_CATALOG_PARAMS_WRITE } from "../../dashboard-builder/dashboards.schema";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import type {
  CreateDashboardTemplateBody,
  ListDashboardTemplatesQuery,
  UpdateDashboardTemplateBody,
} from "./dashboard-templates.schema";

/**
 * The **section dashboard template** version lifecycle — `F3.36`, migration
 * `0056`, [ADR 0049](../../../../../docs/adr/0049-section-dashboard-templates.md).
 *
 * Deliberately shaped after `AssetTemplatesService`, because ADR 0049 decision 2
 * rules **full lifecycle parity** with ADR 0039: draft → published → archived,
 * `createDraftFrom` off a published version, publish-time validation, and a
 * version stamp on every instantiated dashboard. Importing the stock catalog
 * lives in `DashboardTemplatesStockService`; instantiation lives in
 * `DashboardTemplatesInstantiateService`. This file owns the rows.
 *
 * ---
 *
 * **READS RUN ON `fleetDb`, WRITES ON `tenantDb` INSIDE `withTenant`.** The same
 * split `AssetTemplatesService` uses and for the same reason:
 * `bms.dashboard_templates` carries `FORCE ROW LEVEL SECURITY` from migration
 * `0056`, so a `tenantDb` read with no GUC set sees zero rows. Reads therefore
 * go through the fleet pool and trust the scope filter this service applies via
 * `writableOrganizationIds` / `canManageOrganization` — "bypass, then trust an
 * already-computed grant".
 *
 * **`bms_fleet` holds `BYPASSRLS`**, so that pool is not policed by the policy
 * at all. Every read below is therefore explicitly scoped in its `where`, and
 * that is the isolation control — not the policy. The policy is what protects
 * the `tenantDb` writes.
 *
 * **The audit row is written INSIDE the same transaction as the mutation.**
 * `F3.37`'s pre-merge review found an `UPDATE` whose zero-row RLS refusal still
 * committed an audit row, which is a history that records a change that never
 * happened. Passing the transaction to `audit.write` is what prevents it.
 */

type TemplateRow = typeof dashboardTemplates.$inferSelect;

@Injectable()
export class DashboardTemplatesService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly vocabularies: VocabulariesService,
  ) {}

  /** Lists template versions visible to the caller, newest version first. */
  async list(
    jwt: JwtPayload,
    query: ListDashboardTemplatesQuery,
  ): Promise<{ items: DashboardTemplateSummaryDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableOrgIds = await this.accessControl.writableOrganizationIds(jwt);

    const conditions = [];
    if (query.organizationId) {
      if (!(await this.accessControl.canManageOrganization(jwt, query.organizationId))) {
        throw new ForbiddenException("Organization is outside your access scope");
      }
      conditions.push(eq(dashboardTemplates.organizationId, query.organizationId));
    } else if (writableOrgIds !== null) {
      // `null` is the unrestricted sentinel; an empty array is a real user with
      // no grants, and must see nothing rather than everything.
      if (writableOrgIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(dashboardTemplates.organizationId, writableOrgIds));
    }
    if (query.status) {
      conditions.push(eq(dashboardTemplates.status, query.status));
    }
    if (query.section) {
      conditions.push(eq(dashboardTemplates.section, query.section));
    }

    const rows = await this.fleetDb
      .select({ template: dashboardTemplates })
      .from(dashboardTemplates)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(dashboardTemplates.code), desc(dashboardTemplates.version));

    return { items: rows.map((row) => this.mapSummary(row.template)) };
  }

  async getById(jwt: JwtPayload, id: string): Promise<DashboardTemplateDto> {
    const template = await this.fetchRow(id);
    await this.assertCanRead(jwt, template.organizationId);
    return this.map(template);
  }

  async create(jwt: JwtPayload, body: CreateDashboardTemplateBody): Promise<DashboardTemplateDto> {
    await this.assertCanAuthor(jwt, body.organizationId);
    await this.assertSection(body.section);

    const content = body.content ?? sectionTemplateContentSchema.parse({ widgets: [] });
    // A draft may be incomplete, so only the shape is checked here. The whole
    // stored object is re-proved at publish — see `publish`.
    this.assertContentFits(content);

    const createdBy = await this.resolveCreatedBy(jwt);

    const created = await withTenant(this.tenantDb, body.organizationId, async (tx) => {
      // `MAX(version) + 1`, not a hardcoded 1. `createDraftFrom` and the stock
      // import both compute it, and `AssetTemplatesAdminService.create` does
      // too — ADR 0049 decision 2 rules FULL lifecycle parity, so two `create`
      // methods answering differently for the same input is a contract
      // divergence. It was also the direct cause of a 500: creating a template
      // whose code the organization already held violated
      // `dashboard_templates_org_code_version_unique`. Found by the `F3.36`
      // correctness review.
      const [{ next } = { next: 1 }] = await tx
        .select({ next: sql<number>`COALESCE(MAX(${dashboardTemplates.version}), 0)::int + 1` })
        .from(dashboardTemplates)
        .where(
          and(
            eq(dashboardTemplates.organizationId, body.organizationId),
            eq(dashboardTemplates.code, body.code),
          ),
        );

      const [row] = await tx
        .insert(dashboardTemplates)
        .values({
          organizationId: body.organizationId,
          code: body.code,
          version: next,
          name: body.name,
          section: body.section,
          description: body.description ?? null,
          status: "draft",
          content,
          createdBy,
        })
        .returning();
      if (!row) {
        throw new ConflictException("Dashboard template could not be created");
      }

      await this.audit.write(
        {
          actor: jwt,
          organizationId: body.organizationId,
          action: "master.dashboard_template.create",
          entityType: "dashboard_template",
          entityId: row.id,
        },
        tx,
      );
      return row;
    }).catch((err) => {
      throw DashboardTemplatesService.translateConflict(err, body.code);
    });

    return this.map(created);
  }

  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdateDashboardTemplateBody,
  ): Promise<DashboardTemplateDto> {
    const template = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    this.assertDraft(template, "edited");

    if (body.section !== undefined) {
      await this.assertSection(body.section);
    }
    if (body.content !== undefined) {
      this.assertContentFits(body.content);
    }

    const updated = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      const [row] = await tx
        .update(dashboardTemplates)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.section !== undefined ? { section: body.section } : {}),
          ...(body.description !== undefined ? { description: body.description ?? null } : {}),
          ...(body.content !== undefined ? { content: body.content } : {}),
          updatedAt: new Date(),
        })
        .where(eq(dashboardTemplates.id, id))
        .returning();
      // A zero-row result here is the policy refusing the write, not a missing
      // row — `fetchRow` already proved the row exists. Throwing before the
      // audit write is what keeps history honest (`F3.37`'s review).
      if (!row) {
        throw new NotFoundException("Dashboard template not found");
      }

      await this.audit.write(
        {
          actor: jwt,
          organizationId: template.organizationId,
          action: "master.dashboard_template.update",
          entityType: "dashboard_template",
          entityId: id,
        },
        tx,
      );
      return row;
    });

    return this.map(updated);
  }

  /**
   * Publish a draft.
   *
   * **The whole stored object is re-proved here, not just what a write
   * carried.** `asset-templates.service.ts` records the reason: a write only
   * validates what it carries, so a `PATCH` that replaced the content and said
   * nothing about a role could leave a reference that no longer resolves. Once
   * a vocabulary became a code rather than an enum, the schema alone stopped
   * being the vocabulary check.
   *
   * **Publish validates the roles; it does not require them to RESOLVE.**
   * Whether *this* organization has an STP train is a per-target question
   * answered at instantiation, and refusing to publish for it would be ADR 0049
   * decision 6's failure one stage earlier — a plant with five of six sections
   * would get nothing at all.
   */
  async publish(jwt: JwtPayload, id: string): Promise<DashboardTemplateDto> {
    const template = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    this.assertTransition(template, "published");

    const content = sectionTemplateContentSchema.parse(template.content);
    if (content.widgets.length === 0) {
      throw new BadRequestException(
        "A template with no widgets would instantiate an empty dashboard",
      );
    }
    this.assertContentFits(content);
    await this.assertSection(template.section);

    for (const widget of content.widgets) {
      for (const binding of widget.bindings) {
        await this.vocabularies.assertAssetRole(binding.assetRoleCode);
      }
      for (const source of widget.sources) {
        if (!(source.catalogKey in METRIC_CATALOG)) {
          throw new BadRequestException(
            `Widget "${widget.key}" binds unknown catalog entry "${source.catalogKey}"`,
          );
        }
        // `params` must pass the SAME per-entry schema the dashboard write path
        // applies. The contract docblock claimed this happened and nothing did
        // it — found by the `F3.36` security review.
        //
        // Every entry's schema is `z.object({}).strict()` today, so this refuses
        // any non-empty `params`, exactly as `PUT /dashboards/:id/widgets` does.
        // The risk it closes is not hypothetical in shape: an author could
        // otherwise persist `{"locationId": "<foreign uuid>"}` into
        // `dashboard_widget_sources.params`, which `dashboards.schema.ts` calls
        // "an id inside jsonb that no foreign key covers and no orphan check can
        // report". Latent only because no resolve path reads a param yet.
        const paramsSchema = METRIC_CATALOG_PARAMS_WRITE[source.catalogKey];
        const parsed = paramsSchema.safeParse(source.params);
        if (!parsed.success) {
          throw new BadRequestException(
            `Widget "${widget.key}" binds catalog entry "${source.catalogKey}" with invalid params: ` +
              JSON.stringify(parsed.error.flatten()),
          );
        }
      }
    }

    const now = new Date();
    const published = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      const [row] = await tx
        .update(dashboardTemplates)
        .set({ status: "published", publishedAt: now, updatedAt: now })
        .where(eq(dashboardTemplates.id, id))
        .returning();
      if (!row) {
        throw new NotFoundException("Dashboard template not found");
      }

      await this.audit.write(
        {
          actor: jwt,
          organizationId: template.organizationId,
          action: "master.dashboard_template.publish",
          entityType: "dashboard_template",
          entityId: id,
        },
        tx,
      );
      return row;
    });

    return this.map(published);
  }

  async archive(jwt: JwtPayload, id: string): Promise<DashboardTemplateDto> {
    const template = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    this.assertTransition(template, "archived");

    const now = new Date();
    const archived = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      const [row] = await tx
        .update(dashboardTemplates)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(eq(dashboardTemplates.id, id))
        .returning();
      if (!row) {
        throw new NotFoundException("Dashboard template not found");
      }

      await this.audit.write(
        {
          actor: jwt,
          organizationId: template.organizationId,
          action: "master.dashboard_template.archive",
          entityType: "dashboard_template",
          entityId: id,
        },
        tx,
      );
      return row;
    });

    return this.map(archived);
  }

  /**
   * Open a new draft from a published version.
   *
   * **`stockCode` and `stockVersion` are copied forward**, or *"which stock
   * version did this come from"* becomes unanswerable the moment an
   * organization edits an imported template — which is the first thing an
   * organization does with one (ADR 0049 decision 3).
   *
   * The new draft sits at `max(version) + 1`. The partial unique index
   * `dashboard_templates_org_code_draft_unique` is what makes two concurrent
   * clicks fail at the database rather than produce two rival drafts.
   */
  async createDraftFrom(jwt: JwtPayload, id: string): Promise<DashboardTemplateDto> {
    const template = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    const createdBy = await this.resolveCreatedBy(jwt);
    // Only a published version may be branched: a draft is already editable,
    // and an archived one is frozen for the dashboards pinned to it.
    if (!canOpenDraftFrom(template.status as TemplateLifecycleStatus)) {
      throw new ConflictException(
        branchRefusedMessage(template.status as TemplateLifecycleStatus),
      );
    }

    const created = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      const [{ next } = { next: template.version + 1 }] = await tx
        .select({ next: sql<number>`COALESCE(MAX(${dashboardTemplates.version}), 0)::int + 1` })
        .from(dashboardTemplates)
        .where(
          and(
            eq(dashboardTemplates.organizationId, template.organizationId),
            eq(dashboardTemplates.code, template.code),
          ),
        );

      const [row] = await tx
        .insert(dashboardTemplates)
        .values({
          organizationId: template.organizationId,
          code: template.code,
          version: next,
          name: template.name,
          section: template.section,
          description: template.description,
          status: "draft",
          content: template.content,
          stockCode: template.stockCode,
          stockVersion: template.stockVersion,
          createdBy,
        })
        .returning();
      if (!row) {
        throw new ConflictException("A draft of this template already exists");
      }

      await this.audit.write(
        {
          actor: jwt,
          organizationId: template.organizationId,
          action: "master.dashboard_template.create",
          entityType: "dashboard_template",
          entityId: row.id,
          reason: `draft from version ${template.version}`,
        },
        tx,
      );
      return row;
    }).catch((err) => {
      throw DashboardTemplatesService.translateConflict(err, template.code);
    });

    return this.map(created);
  }

  /** Deletes a draft. A published or archived version is never hard-deleted —
   * dashboards are pinned to it by `dashboards.template_id`, whose foreign key
   * carries no `ON DELETE` precisely so that a mistake fails loudly. */
  async deleteDraft(jwt: JwtPayload, id: string): Promise<void> {
    const template = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    this.assertDraft(template, "deleted");

    await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      // `.returning()` and the row check are what make this delete match the
      // other three mutations. Without them a concurrent delete between
      // `fetchRow` and here commits an audit row for a deletion that did not
      // happen — the same defect `F3.37`'s review found on an UPDATE, arriving
      // through the one verb that had no row count. Found by the `F3.36`
      // security review.
      const deleted = await tx
        .delete(dashboardTemplates)
        .where(eq(dashboardTemplates.id, id))
        .returning({ id: dashboardTemplates.id });
      if (deleted.length === 0) {
        throw new NotFoundException("Dashboard template not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          organizationId: template.organizationId,
          action: "master.dashboard_template.delete",
          entityType: "dashboard_template",
          entityId: id,
        },
        tx,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Shared internals — also used by the stock and instantiate services.
  // -------------------------------------------------------------------------

  /**
   * The authoring user's row id, for `dashboard_templates.created_by`.
   *
   * **Nothing wrote this column and the DTO advertised it**, so every template
   * reported `createdBy: null` while the response contract and the migration
   * both claimed otherwise. Copied from
   * `AssetTemplatesAdminService.resolveCreatedBy`. Found by the `F3.36`
   * correctness review.
   */
  async resolveCreatedBy(jwt: JwtPayload): Promise<string | null> {
    const [row] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
      .limit(1);
    return row?.id ?? null;
  }

  async fetchRow(id: string): Promise<TemplateRow> {
    const [row] = await this.fleetDb
      .select({ template: dashboardTemplates })
      .from(dashboardTemplates)
      .innerJoin(organizations, eq(dashboardTemplates.organizationId, organizations.id))
      .where(eq(dashboardTemplates.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Dashboard template not found");
    }
    return row.template;
  }

  /**
   * Author permission: org-scoped, `location_admin` excluded — ADR 0015 §7, the
   * same rule `AssetTemplatesService.assertCanAuthor` applies.
   *
   * **This used `canManageOrganization` and that was an authorization gap.**
   * That predicate resolves through `writableOrganizationIds`, which for a
   * `location_admin` returns `locationDerivedOrganizationIds` — so ONE location
   * grant returned `true` for the whole organization, and
   * `wc-admin@bms.local` could create, edit, publish, archive, delete and import
   * organization-wide section templates. `canManageTemplate` is the predicate
   * that excludes the role, and its own docblock says why: authoring a template
   * is an organization-wide act.
   *
   * The gap was invisible from the browser, which is what made it worth a
   * comment: `apps/web/src/lib/template-authoring-access.ts` claims to "mirror
   * the server exactly" and hides the controls from `location_admin`, so the
   * request was never sent. Found by the `F3.36` security review.
   */
  async assertCanAuthor(jwt: JwtPayload, organizationId: string): Promise<void> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role === "location_admin") {
      throw new ForbiddenException("Location admins cannot author dashboard templates");
    }
    if (!(await this.accessControl.canManageTemplate(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
  }

  /**
   * Read permission: `canManageOrganization`, deliberately wider than
   * `assertCanAuthor`.
   *
   * A `location_admin` may LIST and OPEN a template — that is
   * model-once-deploy-many, the property ADR 0015 Amendment 1B exists to
   * preserve. Only authoring is refused. Splitting the two is what stops the
   * authoring fix above from taking the read away as a side effect.
   */
  async assertCanRead(jwt: JwtPayload, organizationId: string): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageOrganization(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
  }

  /**
   * The section must exist and be active in `bms.dashboard_sections`.
   *
   * The vocabulary is **open** (ADR 0049 Amendment 2 decision 5), so the request
   * schema checks shape only and this is the whole boundary — the same division
   * `VocabulariesService.assertAssetRole` uses for roles. Without it an unknown
   * code reaches Postgres and returns as `dashboard_templates_section_fkey`: a
   * 500 where there should be a 400, and one that names no valid options.
   */
  async assertSection(code: string): Promise<void> {
    const [row] = await this.fleetDb
      .select({ active: dashboardSections.active })
      .from(dashboardSections)
      .where(eq(dashboardSections.code, code))
      .limit(1);

    if (!row || !row.active) {
      const live = await this.fleetDb
        .select({ code: dashboardSections.code })
        .from(dashboardSections)
        .where(eq(dashboardSections.active, true))
        .orderBy(asc(dashboardSections.sortOrder));
      throw new BadRequestException(
        `Unknown dashboard section "${code}". Valid sections: ${live
          .map((s) => s.code)
          .join(", ")}`,
      );
    }
  }

  /**
   * Turn a named unique violation into the 409 it is, instead of a 500.
   *
   * **Every `if (!row)` guard around a `.returning()` insert was dead code.**
   * Drizzle THROWS on a `23505`; it never returns an empty array. So a duplicate
   * `code`, a second concurrent draft or a repeated slug all reached the client
   * as a 500 carrying a raw constraint name. `AssetTemplatesAdminService.translateDraftConflict`
   * and `DashboardsService.translateSlugConflict` are the two precedents this
   * copies. Found by the `F3.36` correctness review.
   */
  static translateConflict(err: unknown, code: string): unknown {
    const constraint = (err as { constraint?: string } | null)?.constraint;
    if (constraint === "dashboard_templates_org_code_draft_unique") {
      return new ConflictException(
        `A draft of template "${code}" already exists in this organization. Publish or delete it first.`,
      );
    }
    if (constraint === "dashboard_templates_org_code_version_unique") {
      return new ConflictException(
        `A version of template "${code}" already exists in this organization at that number.`,
      );
    }
    return err;
  }

  /** The widget cap, which no row-level `CHECK` can see. */
  private assertContentFits(content: SectionTemplateContent): void {
    if (content.widgets.length > MAX_DASHBOARD_WIDGETS) {
      throw new BadRequestException(
        `A dashboard template holds at most ${MAX_DASHBOARD_WIDGETS} widgets`,
      );
    }
  }

  /** Only a draft may be edited or deleted — the shared rule, not a local one. */
  private assertDraft(template: TemplateRow, verb: TemplateDraftRequiredVerb): void {
    if (!canMutate(template.status as TemplateLifecycleStatus)) {
      throw new ConflictException(
        draftRequiredMessage(template.status as TemplateLifecycleStatus, verb),
      );
    }
  }

  /** A lifecycle transition, checked against the one declaration. Identical to
   * `AssetTemplatesService.assertTransition` by design — decision 2's parity is
   * held by both reading `template-lifecycle.ts`, not by the two files looking
   * alike. */
  private assertTransition(template: TemplateRow, to: TemplateLifecycleStatus): void {
    const from = template.status as TemplateLifecycleStatus;
    if (canTransition(from, to)) return;
    throw new ConflictException(
      to === "archived" ? archiveRefusedMessage(from) : draftRequiredMessage(from, "published"),
    );
  }

  map(template: TemplateRow): DashboardTemplateDto {
    return dashboardTemplateDtoSchema.parse({
      id: template.id,
      organizationId: template.organizationId,
      code: template.code,
      version: template.version,
      name: template.name,
      section: template.section,
      description: template.description,
      status: template.status,
      content: sectionTemplateContentSchema.parse(template.content),
      publishedAt: template.publishedAt?.toISOString() ?? null,
      archivedAt: template.archivedAt?.toISOString() ?? null,
      stockCode: template.stockCode,
      stockVersion: template.stockVersion,
      createdBy: template.createdBy,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    });
  }

  private mapSummary(template: TemplateRow): DashboardTemplateSummaryDto {
    const content = sectionTemplateContentSchema.parse(template.content);
    return {
      id: template.id,
      organizationId: template.organizationId,
      code: template.code,
      version: template.version,
      name: template.name,
      section: template.section,
      description: template.description,
      status: template.status as TemplateLifecycleStatus,
      publishedAt: template.publishedAt?.toISOString() ?? null,
      archivedAt: template.archivedAt?.toISOString() ?? null,
      stockCode: template.stockCode,
      stockVersion: template.stockVersion,
      widgetCount: content.widgets.length,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}
