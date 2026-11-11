import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { assetDomains, organizations, workOrderChecklistTemplateItems, workOrderChecklistTemplates } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  CreateWorkOrderChecklistTemplateBody,
  JwtPayload,
  UpdateWorkOrderChecklistTemplateBody,
  WorkOrderChecklistTemplateDto,
  WorkOrderChecklistTemplatesResponse,
} from "@bms/shared";

import { resolveActorId } from "../../auth/identity-resolver";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";

type Actor = Pick<JwtPayload, "sub" | "email">;
type ItemInput = CreateWorkOrderChecklistTemplateBody["items"][number];

const NAME_KEY = "work_order_checklist_templates_organization_name_key";
const NAME_TAKEN = "A checklist template with this name already exists";
const TEMPLATE_NOT_FOUND = "Checklist template not found";

/** The `23505` of the case-insensitive name key, whether or not a layer above `pg` wrapped it. */
function isNameKeyViolation(err: unknown): boolean {
  for (const candidate of [err, (err as { cause?: unknown } | null)?.cause]) {
    const e = candidate as { code?: unknown; constraint?: unknown } | null | undefined;
    if (e && e.code === "23505" && e.constraint === NAME_KEY) return true;
  }
  return false;
}

/**
 * `E3.1` (ADR 0122 decision 4.2, plan T3.3) — an organization's reusable work-order
 * checklists.
 *
 * Every write is one `withTenant` transaction: the template, its items, the audit row and
 * the read-back commit or roll back together, and the `tenant_isolation` policies bind each
 * statement (ADR 0043 decision 1). The items policy also checks the parent template's
 * organization, so an item cannot be filed against another organization's template.
 *
 * A template is never deleted; `active: false` retires it. Sending `items` on an update
 * REPLACES the whole list, so item ids change: a ticket that already copied an old item
 * keeps its task, and `work_order_tasks.template_item_id` is set NULL by the foreign key.
 *
 * Authorization is the controller's: the role gate, then the organization-level check.
 * This service trusts the organization id it is handed.
 */
@Injectable()
export class WorkOrderChecklistTemplatesAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(MasterDataAuditService) private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * The organization a template belongs to, or `null` when no template has the id. On the
   * fleet pool: the controller needs it to choose the tenant setting, so no setting exists yet.
   */
  async organizationOf(id: string): Promise<string | null> {
    const [row] = await this.fleetDb
      .select({ organizationId: workOrderChecklistTemplates.organizationId })
      .from(workOrderChecklistTemplates)
      .where(eq(workOrderChecklistTemplates.id, id))
      .limit(1);
    return row?.organizationId ?? null;
  }

  /** Every template of the organization, active and retired, ordered by name. */
  async list(organizationId: string): Promise<WorkOrderChecklistTemplatesResponse> {
    await this.assertOrganizationExists(organizationId);
    return withTenant(this.db, organizationId, async (tx) => ({ items: await this.read(tx, organizationId) }));
  }

  /** Creates a template and its items, audits once, and answers the read-back. */
  async create(actor: Actor, body: CreateWorkOrderChecklistTemplateBody): Promise<WorkOrderChecklistTemplateDto> {
    const { organizationId, name, items } = body;
    const domain = body.domain ?? null;
    await this.assertOrganizationExists(organizationId);
    await this.assertDomainExists(domain);
    // `bms.users` is a pre-tenant identity table: the actor resolves on the fleet pool (F3.78).
    const actorId = await resolveActorId(this.fleetDb, actor);
    return withTenant(this.db, organizationId, async (tx) => {
      await this.assertNameFree(tx, organizationId, name);
      const [row] = await tx
        .insert(workOrderChecklistTemplates)
        .values({ organizationId, name, domain, createdBy: actorId, updatedBy: actorId })
        .returning({ id: workOrderChecklistTemplates.id });
      await this.insertItems(tx, organizationId, row.id, items);
      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_checklist_template_create",
          entityType: "work_order_checklist_template",
          entityId: row.id,
          reason: "Work-order checklist template created",
          payload: {
            name,
            domain,
            itemCount: items.length,
            mandatoryCount: items.filter((item) => item.mandatory).length,
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );
      return this.readOne(tx, organizationId, row.id);
    }).catch(translateNameConflict);
  }

  /**
   * Applies the keys sent, replaces the items when `items` is sent, audits once, and
   * answers the read-back. `organizationId` is the template's own, from
   * {@link organizationOf}; under any other setting the template reads as absent (404).
   */
  async update(
    actor: Actor,
    id: string,
    organizationId: string,
    body: UpdateWorkOrderChecklistTemplateBody,
  ): Promise<WorkOrderChecklistTemplateDto> {
    if (body.domain !== undefined) {
      await this.assertDomainExists(body.domain);
    }
    const actorId = await resolveActorId(this.fleetDb, actor);
    const changed = (Object.keys(body) as Array<keyof UpdateWorkOrderChecklistTemplateBody>).filter(
      (key) => body[key] !== undefined,
    );
    return withTenant(this.db, organizationId, async (tx) => {
      const [current] = await tx
        .select({
          name: workOrderChecklistTemplates.name,
          domain: workOrderChecklistTemplates.domain,
          active: workOrderChecklistTemplates.active,
        })
        .from(workOrderChecklistTemplates)
        .where(and(eq(workOrderChecklistTemplates.id, id), eq(workOrderChecklistTemplates.organizationId, organizationId)))
        .for("update");
      if (!current) {
        throw new NotFoundException(TEMPLATE_NOT_FOUND);
      }
      const before = { ...current, itemCount: await this.itemCount(tx, id) };
      if (body.name !== undefined) {
        await this.assertNameFree(tx, organizationId, body.name, id);
      }

      // Under FORCE row security an UPDATE whose setting does not match changes zero rows
      // and raises nothing, so the empty `returning` is the only signal.
      const updated = await tx
        .update(workOrderChecklistTemplates)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.domain !== undefined ? { domain: body.domain } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          updatedBy: actorId,
          updatedAt: sql`now()`,
        })
        .where(and(eq(workOrderChecklistTemplates.id, id), eq(workOrderChecklistTemplates.organizationId, organizationId)))
        .returning({ id: workOrderChecklistTemplates.id });
      if (updated.length === 0) {
        throw new NotFoundException(TEMPLATE_NOT_FOUND);
      }

      if (body.items !== undefined) {
        await tx.delete(workOrderChecklistTemplateItems).where(eq(workOrderChecklistTemplateItems.templateId, id));
        await this.insertItems(tx, organizationId, id, body.items);
      }

      const after = await this.readOne(tx, organizationId, id);
      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_checklist_template_update",
          entityType: "work_order_checklist_template",
          entityId: id,
          reason: "Work-order checklist template updated",
          payload: {
            changed,
            before,
            after: { name: after.name, domain: after.domain, active: after.active, itemCount: after.items.length },
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );
      return after;
    }).catch(translateNameConflict);
  }

  /**
   * 404 for an id that names no organization. Only a global admin passes the controller's
   * check with such an id; without this the read would answer an empty list for nothing,
   * and the write would end in a foreign-key error.
   */
  private async assertOrganizationExists(organizationId: string): Promise<void> {
    const [row] = await this.fleetDb
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Organization not found");
    }
  }

  /**
   * A non-null domain must be a code in `bms.asset_domains`, read on the fleet pool because
   * it is platform vocabulary. Checked here so the caller gets a 400 that names the
   * problem rather than a foreign-key error.
   */
  private async assertDomainExists(domain: string | null): Promise<void> {
    if (domain === null) return;
    const [row] = await this.fleetDb
      .select({ code: assetDomains.code })
      .from(assetDomains)
      .where(eq(assetDomains.code, domain))
      .limit(1);
    if (!row) {
      throw new BadRequestException("Unknown asset domain");
    }
  }

  /**
   * Refuses a name the organization already uses, compared case-insensitively as the
   * unique index compares it. The index stays the guarantee: a concurrent create that
   * passes this check meets the `23505`, which `translateNameConflict` maps to the same 409.
   */
  private async assertNameFree(tx: BmsTx, organizationId: string, name: string, exceptId?: string): Promise<void> {
    const [row] = await tx
      .select({ id: workOrderChecklistTemplates.id })
      .from(workOrderChecklistTemplates)
      .where(
        and(
          eq(workOrderChecklistTemplates.organizationId, organizationId),
          sql`lower(${workOrderChecklistTemplates.name}) = lower(${name})`,
          exceptId === undefined ? undefined : ne(workOrderChecklistTemplates.id, exceptId),
        ),
      )
      .limit(1);
    if (row) {
      throw new ConflictException(NAME_TAKEN);
    }
  }

  /** The array order is the checklist order: `sortOrder` is the index plus one. */
  private async insertItems(tx: BmsTx, organizationId: string, templateId: string, items: readonly ItemInput[]): Promise<void> {
    if (items.length === 0) return;
    await tx.insert(workOrderChecklistTemplateItems).values(
      items.map((item, index) => ({
        organizationId,
        templateId,
        title: item.title,
        mandatory: item.mandatory,
        sortOrder: index + 1,
      })),
    );
  }

  private async itemCount(tx: BmsTx, templateId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(workOrderChecklistTemplateItems)
      .where(eq(workOrderChecklistTemplateItems.templateId, templateId));
    return row?.n ?? 0;
  }

  private async readOne(tx: BmsTx, organizationId: string, id: string): Promise<WorkOrderChecklistTemplateDto> {
    const [template] = await this.read(tx, organizationId, id);
    if (!template) {
      throw new NotFoundException(TEMPLATE_NOT_FOUND);
    }
    return template;
  }

  /** The organization's templates (or the one named), each with its items in `sortOrder`. */
  private async read(tx: BmsTx, organizationId: string, id?: string): Promise<WorkOrderChecklistTemplateDto[]> {
    const templates = await tx
      .select()
      .from(workOrderChecklistTemplates)
      .where(
        and(
          eq(workOrderChecklistTemplates.organizationId, organizationId),
          id === undefined ? undefined : eq(workOrderChecklistTemplates.id, id),
        ),
      )
      .orderBy(asc(sql`lower(${workOrderChecklistTemplates.name})`), asc(workOrderChecklistTemplates.id));
    if (templates.length === 0) return [];
    const items = await tx
      .select({
        id: workOrderChecklistTemplateItems.id,
        templateId: workOrderChecklistTemplateItems.templateId,
        title: workOrderChecklistTemplateItems.title,
        mandatory: workOrderChecklistTemplateItems.mandatory,
        sortOrder: workOrderChecklistTemplateItems.sortOrder,
      })
      .from(workOrderChecklistTemplateItems)
      .where(
        inArray(
          workOrderChecklistTemplateItems.templateId,
          templates.map((t) => t.id),
        ),
      )
      .orderBy(asc(workOrderChecklistTemplateItems.sortOrder), asc(workOrderChecklistTemplateItems.id));
    const byTemplate = new Map<string, WorkOrderChecklistTemplateDto["items"]>();
    for (const { templateId, ...item } of items) {
      const list = byTemplate.get(templateId) ?? [];
      list.push(item);
      byTemplate.set(templateId, list);
    }
    return templates.map((t) => ({
      id: t.id,
      organizationId: t.organizationId,
      name: t.name,
      domain: t.domain,
      active: t.active,
      items: byTemplate.get(t.id) ?? [],
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  }
}

/** Maps the name key's `23505` (a create or rename that lost the race) to the pre-check's 409. */
function translateNameConflict(err: unknown): never {
  if (isNameKeyViolation(err)) {
    throw new ConflictException(NAME_TAKEN);
  }
  throw err;
}
