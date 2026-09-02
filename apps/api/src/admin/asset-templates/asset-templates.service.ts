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
// ADR 0049 decision 2 — the template lifecycle is declared once, in
// `@bms/shared/contracts/template-lifecycle`, and both template tables read it.
// The refusal messages moved there unchanged, so the two services cannot drift
// into two different sentences for the same refusal.
// `tests/f3.36-template-lifecycle-single-source.test.ts` fails a second copy.
import {
  archiveRefusedMessage,
  canMutate,
  canTransition,
  draftRequiredMessage,
} from "@bms/shared";
import type {
  AdminAssetTemplateDto,
  AdminAssetTemplateSummaryDto,
  AdminTemplatePointDto,
  AssetTemplateStatus,
  CalcDialect,
  CalcTrigger,
  JwtPayload,
  TemplateDraftRequiredVerb,
  TemplateLifecycleStatus,
  TemplatePointKind,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  findUnresolvedContentRefs,
  templateContentSchema,
  type TemplateContentParsed,
} from "./asset-templates-content.schema";
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

type TemplateRow = typeof assetTemplates.$inferSelect;
type PointRow = typeof templatePoints.$inferSelect;

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
 *     `FORCE` a `tenantDb` read with no GUC would see zero rows.
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
   * One optional argument rather than a second method, so every guard below —
   * point keys active, domain, alarm vocabularies, content references — runs
   * on an import exactly as it runs on a form submission. The stock service
   * never inserts.
   */
  async create(
    jwt: JwtPayload,
    body: CreateAssetTemplateBody,
    stamp?: StockImportStamp,
  ): Promise<AdminAssetTemplateDto> {
    await this.assertCanAuthor(jwt, body.organizationId);
    await this.assertPointKeysActive(body.points);
    // ADR 0031 Amendment 1. Checked here rather than at instantiation because
    // that is where the value is *chosen*: a template stores this domain and
    // stamps it onto every asset built from it, so a bad code caught later
    // surfaces on someone else's batch, long after the form that set it.
    await this.vocabularies.assertAssetDomain(body.domain);
    await this.assertTemplateAlarmVocabularies(body.content);
    if (body.content) {
      this.assertContentRefsResolve(body.content, body.points);
    }
    const createdBy = await this.resolveCreatedBy(jwt);

    const created = await withTenant(this.tenantDb, body.organizationId, async (tx) => {
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
          // Both or neither — `asset_templates_stock_stamp_check` holds it.
          stockCode: stamp?.stockCode ?? null,
          stockVersion: stamp?.stockVersion ?? null,
          createdBy,
        })
        .returning();

      await this.replacePoints(tx, row.id, body.organizationId, body.points);

      // E7.1c (item D): folded into this transaction so the stamped
      // organizationId matches the GUC the strict WITH CHECK now demands.
      // Safe inside the `.catch` below: translateDraftConflict only rewrites
      // a `23505` on `asset_templates_org_code_draft_unique` and returns any
      // other error (including one from this insert) unchanged.
      //
      // ONE row either way: an import is audited as an import, not as a
      // create followed by an import.
      await this.audit.write(
        {
          actor: jwt,
          action: stamp ? "master.asset_template.import" : "master.asset_template.create",
          entityType: "asset_template",
          entityId: row.id,
          organizationId: body.organizationId,
          reason: stamp ? `stock ${stamp.stockCode} v${stamp.stockVersion}` : undefined,
          payload: { code: body.code, version: row.version, points: body.points.length },
        },
        tx,
      );
      return row;
    }).catch((err: unknown) => {
      throw this.translateDraftConflict(err, body.code);
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
      await this.assertPointKeysActive(body.points);
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
    const { template } = await this.fetchRow(id);
    await this.assertCanAuthor(jwt, template.organizationId);
    this.assertTransition(template, "published");

    const points = await this.loadPoints(id);
    if (points.length === 0) {
      throw new BadRequestException(
        "A template with no points would instantiate assets with no telemetry mapping",
      );
    }
    await this.assertPointKeysActive(points);
    const storedContent = this.parseStoredContent(template);
    this.assertContentRefsResolve(storedContent, points);

    // ADR 0032. Publish used to get this for free: `parseStoredContent` ran the
    // schema, and while `severity` and `category` were `z.enum`s the schema was
    // the vocabulary check. Both are codes now, so the schema passes a stored
    // value that no vocabulary row backs, and without this line a pre-ADR row
    // could be published carrying an alarm the rule engine cannot run.
    //
    // `create` and `update` already called this on the *incoming* body; the gap
    // was only ever on stored content, which is exactly what publish reads.
    await this.assertTemplateAlarmVocabularies(storedContent);

    const now = new Date();
    await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      await tx
        .update(assetTemplates)
        .set({ status: "published", publishedAt: now, updatedAt: now })
        .where(eq(assetTemplates.id, id));

      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_template.publish",
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
   * users the pilot authenticates. `MasterDataAuditService.write` already
   * resolves by id-or-email and falls back to null; this does the same, which
   * is why the column is nullable.
   *
   * E7.1b Amendment 4: read on `fleetDb`. `bms.users` gains a `FORCE`d policy in
   * `0047`, and the author is often a scoped actor whose own row would fail a
   * tenant-pool read here — dropping `created_by` silently to null. The identity
   * lookup is a pre-tenant read, so it bypasses, exactly as `resolveActorId`
   * does in `WorkOrdersService`/`MaintenanceService`.
   */
  private async resolveCreatedBy(jwt: JwtPayload): Promise<string | null> {
    const [row] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
      .limit(1);
    return row?.id ?? null;
  }

  /**
   * Author permission: org-scoped, `location_admin` excluded (ADR 0015 §7).
   * Public since `F2.13` so `AssetTemplatesStockService.import` can refuse an
   * actor BEFORE naming the available codes; `create` checks it again.
   */
  async assertCanAuthor(jwt: JwtPayload, organizationId: string): Promise<void> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role === "location_admin") {
      throw new ForbiddenException("Location admins cannot author asset templates");
    }
    if (!(await this.accessControl.canManageTemplate(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
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

  /**
   * A lifecycle transition, checked against the one declaration.
   *
   * The two refusal strings are asserted on byte for byte by
   * `asset-templates.lifecycle.integration.spec.ts`, which is why they live in
   * `template-lifecycle.ts` rather than being rebuilt here.
   */
  private assertTransition(template: TemplateRow, to: TemplateLifecycleStatus): void {
    const from = template.status as TemplateLifecycleStatus;
    if (canTransition(from, to)) return;
    throw new ConflictException(
      to === "archived" ? archiveRefusedMessage(from) : draftRequiredMessage(from, "published"),
    );
  }

  /**
   * Every point key must resolve to an **active** row in the fleet-wide catalog
   * (ADR 0010 §5, as amended), and the error names every offending code.
   *
   * Naming them matters: instantiation re-validates through the same rule, and
   * a caller told only "invalid point key" has to bisect a 40-point template by
   * hand to find which one was deactivated.
   *
   * **`F3.42` — this stays, beside migration `0058`'s foreign key, because the
   * two check different things.** The constraint holds *existence* against
   * every writer, including the seed, which does not come through here. This
   * holds `active = true`, which no foreign key can express — a retired code
   * keeps its row — and it names the codes, which a constraint violation cannot.
   * ADR 0051 Amendment 3 decision 2.
   *
   * The message said "this organization's active point-key catalog" until
   * `F3.42`. There has been no organization catalog since `0057`;
   * `resolveCatalogPointKey`'s equivalent was corrected in `F3.39` and this one
   * was missed.
   */
  private async assertPointKeysActive(
    points: { pointKey: string }[],
  ): Promise<void> {
    if (points.length === 0) {
      return;
    }
    const codes = [...new Set(points.map((point) => point.pointKey))];
    const rows = await this.fleetDb
      .select({ code: pointKeys.code })
      .from(pointKeys)
      // `F3.39`: fleet-wide catalog, so the lookup is by code alone.
      .where(and(eq(pointKeys.active, true), inArray(pointKeys.code, codes)));

    const active = new Set(rows.map((row) => row.code));
    const missing = codes.filter((code) => !active.has(code));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Not in the active point-key catalog: ${missing.join(", ")}`,
      );
    }
  }

  /**
   * A template's stored point set, ordered as `replacePoints` wrote it.
   *
   * E7.1b: read on `fleetDb`. Under `0047`'s `FORCE` a `tenantDb` read with no
   * GUC would see zero rows — and `publish` reads this to reject "no points",
   * so the failure would be a loud but wrong rejection.
   */
  private async loadPoints(templateId: string): Promise<PointRow[]> {
    return this.fleetDb
      .select()
      .from(templatePoints)
      .where(eq(templatePoints.templateId, templateId))
      .orderBy(asc(templatePoints.sortOrder));
  }

  /**
   * Re-parses a stored `content` value under the current contract.
   *
   * `F2.1` shipped this column behind `z.record(z.unknown())`, so a row written
   * before ADR 0019 may hold JSON the tightened envelope rejects. Such a row
   * keeps reading and keeps instantiating — nothing consumes `content` — but it
   * cannot be *published*, because publishing puts it behind an immutable
   * version, which is the one state with no cheap way out. The error says how
   * to move forward rather than only what is wrong.
   */
  private parseStoredContent(template: TemplateRow): TemplateContentParsed {
    const parsed = templateContentSchema.safeParse(template.content ?? {});
    if (!parsed.success) {
      // Report *structure*, never values. Stored content on a pre-ADR row is
      // arbitrary JSON, and zod's own message text echoes the received value
      // back for `invalid_enum_value` ("… received 'x'"). Paths, unexpected key
      // names and issue codes say everything an author needs to fix it. Our own
      // `custom` messages are kept because we wrote them and they interpolate
      // only a key name and a byte count — and because they are the only place
      // a reserved section explains which item it is waiting for.
      const detail = parsed.error.issues
        .map((issue) => {
          const at = issue.path.join(".") || "content";
          if (issue.code === "custom") {
            return `${at}: ${issue.message}`;
          }
          if (issue.code === "unrecognized_keys") {
            return `${at}: unrecognized key(s) ${issue.keys.join(", ")}`;
          }
          return `${at}: ${issue.code}`;
        })
        .join("; ");
      throw new BadRequestException(
        "This template's stored content does not match the current content contract, " +
          `so it cannot be published. PATCH \`content\` into conformance first. ${detail}`,
      );
    }
    return parsed.data;
  }

  /**
   * Every point key `content` names must be one the template declares
   * (ADR 0019 §6) — not merely one in the org's catalog. A KPI referencing a
   * catalogued point the template does not carry produces an asset with no such
   * point on it, which is broken on every instance rather than on one.
   *
   * Names every unresolved key, for the same reason `assertPointKeysActive`
   * does: bisecting a forty-point template by hand is not a debugging strategy.
   */
  /**
   * ADR 0019 §3's binding of template `content.alarms[].category` to the live
   * rule vocabulary, **relocated rather than dropped** (ADR 0031 Amendment 1).
   *
   * It used to be free: `templateContentSchema` typed the field with the shared
   * `z.enum`, so an unknown category was a Zod issue naming the valid values.
   * With the vocabulary now in `bms.rule_categories`, a pure schema cannot know
   * the set — but the guarantee is worth keeping, so it moves to the one layer
   * that can ask.
   *
   * **Why keep it at all**, given nothing converts a template alarm into an
   * `automation_rules` row today: the point is that a template is an authoring
   * surface. A category that no longer exists is a defect authored *now* and
   * discovered whenever that conversion is built — which is exactly the shape
   * of the `electrical` bug this whole ADR is unwinding, where a value sat
   * unnoticed in the database for as long as it took someone to look.
   */
  private async assertTemplateAlarmVocabularies(
    content: TemplateContentParsed | undefined,
  ): Promise<void> {
    const alarms = content?.alarms ?? [];
    if (alarms.length === 0) {
      return;
    }

    // ADR 0032. `severity` was a `z.enum` until then, so `templateContentSchema`
    // rejected an unknown value by itself; with the vocabulary in the database
    // the schema checks shape only, and without a check here a template could
    // author an alarm at a severity the rule engine cannot run — the drift ADR
    // 0019 §3 exists to prevent. `category` moved the same way under ADR 0031
    // Amendment 1, and `philosophy.skill` under ADR 0034 (`E2.1`).
    //
    // **No branch calls `assertRuleCategory` / `assertAlarmSeverity` /
    // `assertAlarmSkill`, and that is the point of writing them out.** Those
    // methods echo the rejected code back, which is right for a value the
    // caller just typed into a request body and wrong here: this runs over
    // *stored* content, and pre-ADR rows hold arbitrary JSON written by
    // whoever. Echoing would turn a publish rejection into a disclosure
    // channel for whatever the row happens to hold.
    //
    // The severity half was written this way first and the category half was
    // not, which the security review caught: `publish` began calling this method
    // in the same commit, so the echoing category branch was newly reachable
    // over stored content. All three are non-echoing now — they name the path
    // and list the expected codes, and nothing else.
    const {
      ruleCategories: liveCategories,
      alarmSeverities: liveSeverities,
      alarmSkills: liveSkills,
    } = await this.vocabularies.list();

    // `category` is optional on a template alarm, so an absent one is not a
    // failure — it means "unspecified", and the rule builder's default applies
    // if this ever becomes a rule.
    const liveCategoryCodes = new Set(liveCategories.map((row) => row.code));
    const badCategory = alarms.findIndex(
      (alarm) => typeof alarm.category === "string" && !liveCategoryCodes.has(alarm.category),
    );
    if (badCategory >= 0) {
      throw new BadRequestException(
        `content.alarms.${badCategory}.category is not a live category. Expected one of: ${[
          ...liveCategoryCodes,
        ].join(", ")}.`,
      );
    }

    const liveSeverityCodes = new Set(liveSeverities.map((row) => row.code));
    const badSeverity = alarms.findIndex((alarm) => !liveSeverityCodes.has(alarm.severity));
    if (badSeverity >= 0) {
      throw new BadRequestException(
        `content.alarms.${badSeverity}.severity is not a live severity. Expected one of: ${[
          ...liveSeverityCodes,
        ].join(", ")}.`,
      );
    }

    // `philosophy` and `philosophy.skill` are both optional — absent is not a
    // failure, matching `category`'s guard rather than `severity`'s unconditional
    // one.
    const liveSkillCodes = new Set(liveSkills.map((row) => row.code));
    const badSkill = alarms.findIndex(
      (alarm) =>
        typeof alarm.philosophy?.skill === "string" && !liveSkillCodes.has(alarm.philosophy.skill),
    );
    if (badSkill >= 0) {
      throw new BadRequestException(
        `content.alarms.${badSkill}.philosophy.skill is not a live skill. Expected one of: ${[
          ...liveSkillCodes,
        ].join(", ")}.`,
      );
    }
  }

  private assertContentRefsResolve(
    content: TemplateContentParsed,
    points: { pointKey: string }[],
  ): void {
    const missing = findUnresolvedContentRefs(
      content,
      points.map((point) => point.pointKey),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        "Template content references point keys this template does not declare: " +
          `${missing.join(", ")}. Add them to \`points\`, or remove the references.`,
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
    // E7.1b: the parent template's org, stamped onto every point row. Always the
    // org this call's `withTenant` block set as the GUC, so `0047`'s WITH CHECK
    // accepts the insert; without it the insert fails once `template_points` is
    // policied. The delete needs no org — it is keyed by `template_id`, and post
    // -0047 the policy's USING clause scopes it to this org anyway.
    organizationId: string,
    points: (TemplatePointBody | PointRow)[],
  ): Promise<void> {
    await tx.delete(templatePoints).where(eq(templatePoints.templateId, templateId));
    if (points.length === 0) {
      return;
    }
    await tx.insert(templatePoints).values(
      points.map((point, index) => ({
        templateId,
        organizationId,
        pointKey: point.pointKey,
        label: point.label ?? null,
        unit: point.unit ?? null,
        kind: point.kind ?? "measured",
        sourceDataKeyPattern: point.sourceDataKeyPattern ?? null,
        formula: point.formula ?? null,
        formulaDialect: point.formulaDialect ?? null,
        calcTrigger: point.calcTrigger ?? null,
        calcIntervalSeconds: point.calcIntervalSeconds ?? null,
        maxInputAgeSeconds: point.maxInputAgeSeconds ?? null,
        required: point.required ?? true,
        sortOrder: point.sortOrder ?? index,
        // F2.13 / ADR 0052 decision 2 — the tier marking, re-stamped on every
        // write exactly like every other point field. `{}` for a point with
        // no provenance, matching the column's own DB default.
        meta: point.meta ?? {},
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
      // F2.13 / ADR 0052 — which stock release this row was imported from, or
      // both null for a hand-authored template.
      stockCode: template.stockCode,
      stockVersion: template.stockVersion,
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
      formula: point.formula,
      formulaDialect: point.formulaDialect as CalcDialect | null,
      calcTrigger: point.calcTrigger as CalcTrigger | null,
      calcIntervalSeconds: point.calcIntervalSeconds,
      maxInputAgeSeconds: point.maxInputAgeSeconds,
      required: point.required,
      sortOrder: point.sortOrder,
      // F2.13 / ADR 0052 decision 2. `point.meta` is jsonb — cast rather than
      // trusted, the same reason `mapTemplate` casts `content`.
      meta: point.meta as AdminTemplatePointDto["meta"],
      createdAt: point.createdAt.toISOString(),
    };
  }
}
