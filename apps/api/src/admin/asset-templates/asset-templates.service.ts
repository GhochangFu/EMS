import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { assetTemplates, organizations, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
// ADR 0049 decision 2 — the template lifecycle is declared once, in
// `@bms/shared/contracts/template-lifecycle`, and both template tables read it.
// The refusal messages moved there unchanged, so the two services cannot drift
// into two different sentences for the same refusal.
// `tests/f3.36-template-lifecycle-single-source.test.ts` fails a second copy.
import { canMutate, draftRequiredMessage } from "@bms/shared";
import type {
  AdminAssetTemplateDto,
  AdminAssetTemplateSummaryDto,
  AssetTemplateStatus,
  JwtPayload,
  TemplateDraftRequiredVerb,
  TemplateLifecycleStatus,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { resolveActorId } from "../../auth/identity-resolver";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { type BmsTx, withTenant } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { TemplateContentParsed } from "./asset-templates-content.schema";
import type { CrossRefCandidatePoint } from "./asset-templates-cross-refs";
// `F2.7` design decision 11 — the two row mappers this service held inline
// moved to a pure sibling when it stood at 998 of §4.5's 1000 lines.
import { toTemplatePointDto } from "./asset-templates-point-rows";
import {
  createTemplateCore,
  publishTemplateCore,
  type TemplateWriteCoreDeps,
} from "./asset-templates-write-core";
import {
  assertCanAuthor,
  assertContentRefsResolve,
  assertParameterKeysKnown,
  assertPointKeysActive,
  assertTemplateAlarmVocabularies,
  assertTransition,
  loadTemplatePoints,
  replacePoints,
  translateDraftConflict,
  type PointRow,
  type TemplateRow,
} from "./asset-templates-write-guards";
import type {
  CreateAssetTemplateBody,
  TemplatePointBody,
  UpdateAssetTemplateBody,
} from "./asset-templates.schema";
import type { StockImportStamp } from "./stock-catalog/types";

/**
 * The template **version lifecycle** (ADR 0015 §5). Instantiation — building
 * assets from a published version — lives in
 * `AssetTemplateInstantiationService`; it is the only operation in this module
 * that writes outside `asset_templates`/`template_points`.
 */


/**
 * `F4.16` / ADR 0043 — `asset_templates` carries `ENABLE ROW LEVEL SECURITY`
 * (migration `0040`); `point_keys` does too. Reads run on `fleetDb`, trusting
 * the scope filter this service already applies via
 * `writableOrganizationIds`/`canManageOrganization` — the same "bypass, then
 * trust an already-computed grant" shape `AccessControlService` uses for its
 * own `bms_auth` reads.
 *
 * **E7.1b (ADR 0043 §5).** `template_points` is now a tenant table too: it
 * gained a nullable `organization_id` in migration `0046` and gets a
 * `tenant_isolation` policy + `FORCE` in `0047`, with its org resolving via
 * `template_id → asset_templates` (an already org-scoped parent). So:
 *   - every `template_points` **write** stamps `organization_id` = the parent
 *     template's org, inside the `withTenant(tenantDb, organizationId, …)` block
 *     the write already runs in (`replacePoints` takes the org for this reason);
 *   - every `template_points` **read** moves to `fleetDb`, behind the same
 *     already-computed grant the `asset_templates` reads trust — under `0047`'s
 *     `FORCE` a `tenantDb` read with no GUC would see zero rows. **Except**
 *     in the create/publish cores (`F3.22`, ADR 0091 decision 1), which read
 *     on the `withTenant` transaction, where the GUC is set.
 * `users` is likewise policied in `0047` (Amendment 4, a pre-tenant identity
 * table), so `resolveCreatedBy` reads it on `fleetDb`.
 *
 * Every write to `asset_templates` runs inside
 * `withTenant(tenantDb, organizationId, …)`; the id is always known before
 * the write (from the request body, or from a fetched template row).
 */
@Injectable()
export class AssetTemplatesAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly vocabularies: VocabulariesService,
    // `E4.1a` — the `$key` vocabulary check (ADR 0070 decision 4), exported by `CalcModule`.
    private readonly calcParameters: CalcParametersService,
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

    const rows = await this.fleetDb
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
   *
   * `stamp` (`F2.13`, ADR 0052 decisions 4 and 5) is what a stock import
   * passes and a hand-authored draft does not: it sets `stock_code` /
   * `stock_version` and switches the audit to `master.asset_template.import`.
   * One optional argument rather than a second method, so every guard in
   * `createTemplateCore` —
   * point keys active, domain, alarm vocabularies, content references — runs
   * on an import exactly as it runs on a form submission. The stock service
   * never inserts.
   */
  async create(
    jwt: JwtPayload,
    body: CreateAssetTemplateBody,
    stamp?: StockImportStamp,
  ): Promise<AdminAssetTemplateDto> {
    // F3.22 PR 1 (ADR 0091 decision 1): every guard runs in the core, inside
    // this transaction — the order and the texts are the ones `create` had.
    const created = await withTenant(this.tenantDb, body.organizationId, (tx) =>
      this.createInTransaction(tx, jwt, body, stamp),
    ).catch((err: unknown) => {
      throw translateDraftConflict(err, body.code);
    });

    return this.getById(jwt, created.id);
  }

  /**
   * `create` on a transaction the caller already holds (`F3.22`, ADR 0091
   * decision 1): every guard reads through `tx`, so a point key written
   * earlier in the same transaction is visible. Returns the inserted row; the
   * caller owns the transaction, the draft-conflict translation and the DTO.
   */
  async createInTransaction(
    tx: BmsTx,
    jwt: JwtPayload,
    body: CreateAssetTemplateBody,
    stamp?: StockImportStamp,
  ): Promise<TemplateRow> {
    return createTemplateCore(this.coreDeps(), tx, jwt, body, stamp);
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
      await this.assertPointKeysActive(body.points);
    }
    if (body.points || body.content?.kpis) {
      await this.assertParameterKeysKnown(body.points ?? (await this.loadPoints(id)), body.content?.kpis);
    }
    if (body.domain !== undefined) {
      await this.vocabularies.assertAssetDomain(body.domain);
    }
    await this.assertTemplateAlarmVocabularies(body.content);
    if (body.content) {
      // The effective point set: what this request carries when it carries
      // points, and what is already stored when it does not. A `PATCH` that
      // sends content alone is the common authoring case and must resolve
      // against the points the template actually has.
      this.assertContentRefsResolve(body.content, body.points ?? (await this.loadPoints(id)));
    }

    await withTenant(this.tenantDb, template.organizationId, async (tx) => {
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
        await this.replacePoints(tx, id, template.organizationId, body.points);
      }

      // `content` is summarised, not spread: it is bounded at 256 KiB and an
      // audit row per edit carrying a full copy grows `bms.audit_log` by the
      // size of the template on every keystroke-level save. The *fact* of a
      // content change is what an audit trail needs; the content itself is on
      // the version row, which is immutable once published.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_template.update",
          entityType: "asset_template",
          entityId: id,
          organizationId: template.organizationId,
          payload: {
            ...body,
            content: body.content
              ? { changed: true, sections: Object.keys(body.content) }
              : undefined,
            points: body.points?.length,
          },
        },
        tx,
      );
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
   *
   * `content` is re-checked for the same reason plus one of its own (ADR 0019
   * §6): `content` and `points` are patched *independently*, so a `PATCH` that
   * replaces the point set and says nothing about content silently orphans
   * every content reference to a removed key. Nothing at that write notices,
   * because a write only validates what it carries. This is where the whole
   * object is re-proved consistent.
   */
  async publish(jwt: JwtPayload, id: string): Promise<AdminAssetTemplateDto> {
    // The organization for `withTenant`, and the same 404 first, as before.
    // F3.22 PR 1: the core re-reads the row through `tx` and holds every check.
    const { template } = await this.fetchRow(id);
    await withTenant(this.tenantDb, template.organizationId, (tx) =>
      this.publishInTransaction(tx, jwt, id),
    );
    return this.getById(jwt, id);
  }

  /**
   * `publish` on a transaction the caller already holds (`F3.22`, ADR 0091
   * decision 1): the row, its points and the point-key catalog are read
   * through `tx`, so a draft written earlier in the same transaction can be
   * published. Returns the updated row.
   */
  async publishInTransaction(tx: BmsTx, jwt: JwtPayload, id: string): Promise<TemplateRow> {
    return publishTemplateCore(this.coreDeps(), tx, jwt, id);
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
    this.assertTransition(template, "archived");

    const now = new Date();
    await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      await tx
        .update(assetTemplates)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(eq(assetTemplates.id, id));

      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_template.archive",
          entityType: "asset_template",
          entityId: id,
          organizationId: template.organizationId,
          payload: { code: template.code, version: template.version },
        },
        tx,
      );
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

    // E7.1b: `template_points` read on `fleetDb` (see the class doc). The source
    // rows carry the parent's org already; `replacePoints` re-stamps them onto
    // the new draft's org below, which is identical for a fork.
    const source = await this.fleetDb
      .select()
      .from(templatePoints)
      .where(eq(templatePoints.templateId, id))
      .orderBy(asc(templatePoints.sortOrder));
    const createdBy = await this.resolveCreatedBy(jwt);

    const draft = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
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
          // ADR 0052 decision 7: the stamp is copied forward, exactly as the
          // dashboard service does, or "which stock did this come from"
          // becomes unanswerable the first time an organization edits an
          // import.
          stockCode: template.stockCode,
          stockVersion: template.stockVersion,
          createdBy,
        })
        .returning();

      await this.replacePoints(tx, row.id, template.organizationId, source);

      // E7.1c (item D): folded, same reasoning as `create` above — the
      // `.catch` below only rewrites a `23505` on the draft-uniqueness
      // constraint and passes any other error through unchanged.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_template.draft",
          entityType: "asset_template",
          entityId: row.id,
          organizationId: template.organizationId,
          payload: { code: template.code, fromVersion: template.version, version: row.version },
        },
        tx,
      );
      return row;
    }).catch((err: unknown) => {
      throw this.translateDraftConflict(err, template.code);
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
    await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      await tx.delete(assetTemplates).where(eq(assetTemplates.id, id));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_template.delete_draft",
          entityType: "asset_template",
          entityId: id,
          organizationId: template.organizationId,
          payload: { code: template.code, version: template.version },
        },
        tx,
      );
    });
    return { deleted: true };
  }

  /**
   * Resolves the actor to a real `bms.users.id`, or `null`.
   *
   * `jwt.sub` is NOT a `bms.users.id` in OIDC mode — it is Keycloak's subject,
   * which has no row here. Writing it into `created_by` violates
   * `asset_templates_created_by_fkey` and 500s every create for exactly the
   * users the pilot authenticates. Since `F3.78` this is the shared
   * `resolveActorId` (by OIDC subject, or local id — never by email), which
   * falls back to null; that is why the column is nullable.
   *
   * E7.1b Amendment 4: read on `fleetDb`. `bms.users` gains a `FORCE`d policy in
   * `0047`, and the author is often a scoped actor whose own row would fail a
   * tenant-pool read here — dropping `created_by` silently to null. The identity
   * lookup is a pre-tenant read, so it bypasses, exactly as `resolveActorId`
   * does in `WorkOrdersService`/`MaintenanceService`.
   */
  private async resolveCreatedBy(jwt: JwtPayload): Promise<string | null> {
    // F3.78: by subject (or local id), never by email — the shared resolver.
    return resolveActorId(this.fleetDb, jwt);
  }

  /** The dependencies the create/publish cores take (`F3.22` PR 1). */
  private coreDeps(): TemplateWriteCoreDeps {
    return {
      fleetDb: this.fleetDb,
      accessControl: this.accessControl,
      audit: this.audit,
      vocabularies: this.vocabularies,
      calcParameters: this.calcParameters,
    };
  }

  /** Delegates to the write-guards module (`F3.22` PR 1). */
  async assertCanAuthor(jwt: JwtPayload, organizationId: string): Promise<void> {
    return assertCanAuthor(this.accessControl, jwt, organizationId);
  }

  /**
   * Only a draft may be edited or deleted — a lifecycle rule, not a transition,
   * because editing a draft leaves it a draft. `canMutate` and the message both
   * come from the one declaration (ADR 0049 decision 2); a hand-rolled
   * `status !== "draft"` here would satisfy the letter of that decision and
   * none of it.
   */
  private assertDraft(template: TemplateRow, verb: TemplateDraftRequiredVerb): void {
    if (!canMutate(template.status as TemplateLifecycleStatus)) {
      throw new ConflictException(
        draftRequiredMessage(template.status as TemplateLifecycleStatus, verb),
      );
    }
  }

  /** Delegates to the write-guards module (`F3.22` PR 1). */
  private assertTransition(template: TemplateRow, to: TemplateLifecycleStatus): void {
    assertTransition(template, to);
  }

  /** Delegates to the write-guards module (`F3.22` PR 1). */
  private async assertPointKeysActive(points: CrossRefCandidatePoint[]): Promise<void> {
    return assertPointKeysActive(this.fleetDb, points);
  }

  /** Delegates to the write-guards module (`F3.22` PR 1). */
  private async assertParameterKeysKnown(
    points: readonly CrossRefCandidatePoint[],
    kpis: readonly { expression: string; dialect?: string | null }[] | undefined,
  ): Promise<void> {
    return assertParameterKeysKnown(this.calcParameters, points, kpis);
  }

  /** Delegates to the write-guards module (`F3.22` PR 1). */
  private async loadPoints(templateId: string): Promise<PointRow[]> {
    return loadTemplatePoints(this.fleetDb, templateId);
  }

  /** Delegates to the write-guards module (`F3.22` PR 1). */
  private async assertTemplateAlarmVocabularies(
    content: TemplateContentParsed | undefined,
  ): Promise<void> {
    return assertTemplateAlarmVocabularies(this.vocabularies, this.tenantDb, content);
  }

  /** Delegates to the write-guards module (`F3.22` PR 1). */
  private assertContentRefsResolve(
    content: TemplateContentParsed,
    points: { pointKey: string }[],
  ): void {
    assertContentRefsResolve(content, points);
  }

  /** Delegates to the write-guards module (`F3.22` PR 1). */
  private async replacePoints(
    tx: BmsTx,
    templateId: string,
    organizationId: string,
    points: (TemplatePointBody | PointRow)[],
  ): Promise<void> {
    return replacePoints(tx, templateId, organizationId, points);
  }

  /** Delegates to the write-guards module (`F3.22` PR 1). */
  private translateDraftConflict(err: unknown, code: string): unknown {
    return translateDraftConflict(err, code);
  }

  private async fetchRow(id: string): Promise<{
    template: TemplateRow;
    organizationCode: string;
    organizationName: string;
  }> {
    const [row] = await this.fleetDb
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
    // E7.1b: read on `fleetDb`. This backs the DTO every mutation returns, so
    // under `0047`'s `FORCE` a `tenantDb` read with no GUC would make create,
    // update, publish, archive and createDraftFrom all return `points: []` with
    // no error — the one misclassified read whose failure has no surface.
    const points = await this.fleetDb
      .select()
      .from(templatePoints)
      .where(eq(templatePoints.templateId, template.id))
      .orderBy(asc(templatePoints.sortOrder), asc(templatePoints.pointKey));
    return {
      ...this.mapTemplate(template, organizationCode, organizationName),
      points: points.map(toTemplatePointDto),
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
      // F2.13 / ADR 0052 — which stock release this row was imported from, or
      // both null for a hand-authored template.
      stockCode: template.stockCode,
      stockVersion: template.stockVersion,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}
