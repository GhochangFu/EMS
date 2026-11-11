import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import {
  type CreateWorkOrderChecklistTemplateBody,
  type JwtPayload,
  workOrderChecklistTemplateDtoSchema,
  workOrderChecklistTemplatesResponseSchema,
} from "@bms/shared";

import { withTenant } from "../../database/tenant-context";
import type { WorkOrderChecklistTemplatesAdminService } from "./work-order-checklist-templates.service";

/**
 * `E3.1` (ADR 0122 decisions 4.2, 9 and 10; plan T3.3) — the checklist template service
 * against `bms_tenant` and `bms_fleet`. Assertions live here;
 * `work-order-checklist-templates.integration.test.ts` owns the pools, the per-run prefix
 * and the cleanup (ADR 0014). The controller's gates are the controller spec's; what only
 * a real database proves is here: the case-insensitive name key, the replace of the
 * items, the one transaction the audit row shares, and the two halves of the items
 * policy.
 *
 * A and B are seeded organizations. Every row this suite writes is a template whose name
 * starts with the run's prefix, its items, and the audit rows about those templates.
 */
export type ChecklistTemplateFixtures = {
  svc: WorkOrderChecklistTemplatesAdminService;
  /** The same service over a `MasterDataAuditService` whose writes throw. */
  svcWithFailingAudit: WorkOrderChecklistTemplatesAdminService;
  tenantDb: BmsDb;
  fleetPool: pg.Pool;
  /** The seeded global admin. */
  actor: JwtPayload;
  orgA: string;
  orgB: string;
  /** Two codes in `bms.asset_domains`. */
  domain: string;
  otherDomain: string;
  /** The run's prefix; every template name this suite writes starts with it. */
  prefix: string;
};

const UNKNOWN_ORGANIZATION = "00000000-0000-4000-8000-00000000e313";

function body(
  ctx: ChecklistTemplateFixtures,
  name: string,
  overrides: Partial<CreateWorkOrderChecklistTemplateBody> = {},
): CreateWorkOrderChecklistTemplateBody {
  return {
    organizationId: ctx.orgA,
    name: `${ctx.prefix}${name}`,
    domain: null,
    items: [
      { title: "Isolate the supply", mandatory: true },
      { title: "Inspect the terminals", mandatory: false },
      { title: "Record the reading", mandatory: true },
    ],
    ...overrides,
  };
}

/** The SQLSTATE of a driver error, whether or not a layer above `pg` wrapped it. */
function sqlState(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection, but the call succeeded");
    },
    (err: unknown) => err,
  );
}

async function templateRows(ctx: ChecklistTemplateFixtures, name: string): Promise<Array<{ id: string; organization_id: string }>> {
  const { rows } = await ctx.fleetPool.query<{ id: string; organization_id: string }>(
    "SELECT id, organization_id FROM bms.work_order_checklist_templates WHERE lower(name) = lower($1)",
    [name],
  );
  return rows;
}

async function itemRows(
  ctx: ChecklistTemplateFixtures,
  templateId: string,
): Promise<Array<{ title: string; mandatory: boolean; sort_order: number; organization_id: string }>> {
  const { rows } = await ctx.fleetPool.query<{ title: string; mandatory: boolean; sort_order: number; organization_id: string }>(
    `SELECT title, mandatory, sort_order, organization_id FROM bms.work_order_checklist_template_items
      WHERE template_id = $1 ORDER BY sort_order`,
    [templateId],
  );
  return rows;
}

async function auditRows(ctx: ChecklistTemplateFixtures, templateId: string): Promise<Array<{ action: string; organization_id: string; payload: Record<string, unknown> }>> {
  const { rows } = await ctx.fleetPool.query<{ action: string; organization_id: string; payload: Record<string, unknown> }>(
    `SELECT action, organization_id, payload FROM bms.audit_log
      WHERE entity_type = 'work_order_checklist_template' AND entity_id = $1
      ORDER BY created_at, id`,
    [templateId],
  );
  return rows;
}

/** Create stores the template and its items in order with `mandatory`, and answers a read-back the contract accepts. */
export async function createStoresTheTemplateAndItsItemsInOrder(ctx: ChecklistTemplateFixtures): Promise<void> {
  const created = await ctx.svc.create(ctx.actor, body(ctx, "create", { domain: ctx.domain }));
  expect(workOrderChecklistTemplateDtoSchema.parse(created)).toEqual(created);
  expect(created).toMatchObject({ organizationId: ctx.orgA, name: `${ctx.prefix}create`, domain: ctx.domain, active: true });
  expect(created.items.map(({ title, mandatory, sortOrder }) => ({ title, mandatory, sortOrder }))).toEqual([
    { title: "Isolate the supply", mandatory: true, sortOrder: 1 },
    { title: "Inspect the terminals", mandatory: false, sortOrder: 2 },
    { title: "Record the reading", mandatory: true, sortOrder: 3 },
  ]);

  const stored = await itemRows(ctx, created.id);
  expect(stored, "the rows agree with the answer, each stamped with A").toEqual([
    { title: "Isolate the supply", mandatory: true, sort_order: 1, organization_id: ctx.orgA },
    { title: "Inspect the terminals", mandatory: false, sort_order: 2, organization_id: ctx.orgA },
    { title: "Record the reading", mandatory: true, sort_order: 3, organization_id: ctx.orgA },
  ]);
}

/** A second template with the same name in another letter case is 409 and stores nothing; the name is free in B. */
export async function aDuplicateNameInTheOrganizationIs409(ctx: ChecklistTemplateFixtures): Promise<void> {
  const name = `${ctx.prefix}Duplicate`;
  await ctx.svc.create(ctx.actor, body(ctx, "Duplicate"));
  const err = await rejection(ctx.svc.create(ctx.actor, body(ctx, "dUPLICATE")));
  expect(err).toMatchObject({ status: 409 });
  expect(await templateRows(ctx, name), "one template under that name, in A").toHaveLength(1);

  const inB = await ctx.svc.create(ctx.actor, body(ctx, "Duplicate", { organizationId: ctx.orgB }));
  expect(inB.organizationId, "the same name in B is fine").toBe(ctx.orgB);
  expect((await templateRows(ctx, name)).map((row) => row.organization_id).sort()).toEqual([ctx.orgA, ctx.orgB].sort());
}

/** An unknown domain is 400 and an unknown organization 404; neither stores a row. */
export async function anUnknownDomainIs400AndAnUnknownOrganization404(ctx: ChecklistTemplateFixtures): Promise<void> {
  const domain = await rejection(ctx.svc.create(ctx.actor, body(ctx, "unknown-domain", { domain: "no-such-domain" })));
  expect(domain).toMatchObject({ status: 400 });
  const organization = await rejection(
    ctx.svc.create(ctx.actor, body(ctx, "unknown-org", { organizationId: UNKNOWN_ORGANIZATION })),
  );
  expect(organization).toMatchObject({ status: 404 });
  await expect(ctx.svc.list(UNKNOWN_ORGANIZATION)).rejects.toMatchObject({ status: 404 });
  expect(await templateRows(ctx, `${ctx.prefix}unknown-domain`)).toEqual([]);
  expect(await templateRows(ctx, `${ctx.prefix}unknown-org`)).toEqual([]);

  const created = await ctx.svc.create(ctx.actor, body(ctx, "domain-on-update"));
  await expect(
    ctx.svc.update(ctx.actor, created.id, ctx.orgA, { domain: "no-such-domain" }),
    "an update to an unknown domain",
  ).rejects.toMatchObject({ status: 400 });
}

/** Update renames, changes the domain, retires, and replacing `items` leaves exactly the new list in order. */
export async function updateRenamesRetiresAndReplacesTheItems(ctx: ChecklistTemplateFixtures): Promise<void> {
  const created = await ctx.svc.create(ctx.actor, body(ctx, "update"));
  const renamed = await ctx.svc.update(ctx.actor, created.id, ctx.orgA, {
    name: `${ctx.prefix}update-renamed`,
    domain: ctx.otherDomain,
  });
  expect(workOrderChecklistTemplateDtoSchema.parse(renamed)).toEqual(renamed);
  expect(renamed).toMatchObject({ id: created.id, name: `${ctx.prefix}update-renamed`, domain: ctx.otherDomain, active: true });
  expect(renamed.items, "items left out are kept").toEqual(created.items);

  const caseOnly = await ctx.svc.update(ctx.actor, created.id, ctx.orgA, { name: `${ctx.prefix}UPDATE-renamed` });
  expect(caseOnly.name, "a template may change the case of its own name").toBe(`${ctx.prefix}UPDATE-renamed`);

  const retired = await ctx.svc.update(ctx.actor, created.id, ctx.orgA, {
    active: false,
    domain: null,
    items: [
      { title: "New first", mandatory: false },
      { title: "New second", mandatory: true },
    ],
  });
  expect(retired).toMatchObject({ active: false, domain: null });
  expect(retired.items.map(({ title, mandatory, sortOrder }) => ({ title, mandatory, sortOrder }))).toEqual([
    { title: "New first", mandatory: false, sortOrder: 1 },
    { title: "New second", mandatory: true, sortOrder: 2 },
  ]);
  const oldIds = new Set(created.items.map((item) => item.id));
  expect(retired.items.some((item) => oldIds.has(item.id)), "a replace issues new item ids").toBe(false);
  expect((await itemRows(ctx, created.id)).map((row) => row.title), "exactly the new list is stored").toEqual([
    "New first",
    "New second",
  ]);

  const other = await ctx.svc.create(ctx.actor, body(ctx, "update-other"));
  await expect(
    ctx.svc.update(ctx.actor, other.id, ctx.orgA, { name: `${ctx.prefix}update-RENAMED` }),
    "a rename onto another template's name, in another case",
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    ctx.svc.update(ctx.actor, created.id, ctx.orgB, { active: true }),
    "under another organization's setting the template does not exist",
  ).rejects.toMatchObject({ status: 404 });
}

/** When the audit write throws, neither the template nor its items exist, and an update changes nothing. */
export async function aFailedAuditLeavesNothing(ctx: ChecklistTemplateFixtures): Promise<void> {
  const name = `${ctx.prefix}atomic`;
  const title = `${ctx.prefix}atomic-item`;
  await expect(
    ctx.svcWithFailingAudit.create(ctx.actor, body(ctx, "atomic", { items: [{ title, mandatory: true }] })),
  ).rejects.toThrow("audit is down");
  expect(await templateRows(ctx, name), "no template").toEqual([]);
  const { rows } = await ctx.fleetPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.work_order_checklist_template_items WHERE title = $1",
    [title],
  );
  expect(rows[0]?.n, "no item").toBe(0);

  const created = await ctx.svc.create(ctx.actor, body(ctx, "atomic-update"));
  await expect(
    ctx.svcWithFailingAudit.update(ctx.actor, created.id, ctx.orgA, {
      name: `${ctx.prefix}atomic-update-renamed`,
      items: [{ title: "Replaced", mandatory: false }],
    }),
  ).rejects.toThrow("audit is down");
  const [after] = (await ctx.svc.list(ctx.orgA)).items.filter((t) => t.id === created.id);
  expect(after, "the update rolled back whole").toEqual(created);
}

/** One audit row per write, stamped with the organization, carrying counts and never the item titles. */
export async function eachWriteIsAuditedOnce(ctx: ChecklistTemplateFixtures): Promise<void> {
  const created = await ctx.svc.create(ctx.actor, body(ctx, "audit", { domain: ctx.domain }));
  const first = await auditRows(ctx, created.id);
  expect(first.map((row) => [row.action, row.organization_id])).toEqual([["work_order_checklist_template_create", ctx.orgA]]);
  expect(first[0]?.payload).toEqual({
    name: `${ctx.prefix}audit`,
    domain: ctx.domain,
    itemCount: 3,
    mandatoryCount: 2,
    oidcSubject: ctx.actor.sub,
    actorEmail: ctx.actor.email,
  });

  await ctx.svc.update(ctx.actor, created.id, ctx.orgA, { active: false, items: [{ title: "Only", mandatory: false }] });
  const both = await auditRows(ctx, created.id);
  expect(both.map((row) => row.action)).toEqual([
    "work_order_checklist_template_create",
    "work_order_checklist_template_update",
  ]);
  expect(both[1]?.payload).toEqual({
    changed: ["active", "items"],
    before: { name: `${ctx.prefix}audit`, domain: ctx.domain, active: true, itemCount: 3 },
    after: { name: `${ctx.prefix}audit`, domain: ctx.domain, active: false, itemCount: 1 },
    oidcSubject: ctx.actor.sub,
    actorEmail: ctx.actor.email,
  });
  const serialized = JSON.stringify(both.map((row) => row.payload));
  expect(serialized, "no item title reaches the audit payload").not.toContain("Isolate the supply");
  expect(serialized).not.toContain("Only");
}

/**
 * Under B's tenant setting none of A's templates or items is visible, and the items
 * policy refuses both cross-organization inserts: B's id naming A's template under B's
 * setting (the parent check), and B's id naming A's template under A's setting (the
 * row's own column).
 */
export async function bsSettingSeesAndFilesNoneOfAsRows(ctx: ChecklistTemplateFixtures): Promise<void> {
  const created = await ctx.svc.create(ctx.actor, body(ctx, "isolation"));
  const read = (organizationId: string) =>
    withTenant(ctx.tenantDb, organizationId, async (tx) => ({
      templates: (await tx.execute(sql`SELECT id FROM bms.work_order_checklist_templates WHERE id = ${created.id}::uuid`)).rows,
      items: (await tx.execute(sql`SELECT id FROM bms.work_order_checklist_template_items WHERE template_id = ${created.id}::uuid`))
        .rows,
    }));
  const own = await read(ctx.orgA);
  expect(own.templates, "A's setting sees its template").toHaveLength(1);
  expect(own.items, "and its items").toHaveLength(3);
  expect(await read(ctx.orgB), "B's setting sees none of A's rows").toEqual({ templates: [], items: [] });

  const file = (setting: string, organizationId: string) =>
    rejection(
      withTenant(ctx.tenantDb, setting, (tx) =>
        tx.execute(sql`INSERT INTO bms.work_order_checklist_template_items (organization_id, template_id, title)
                       VALUES (${organizationId}::uuid, ${created.id}::uuid, ${`${ctx.prefix}smuggled`})`),
      ),
    );
  expect(sqlState(await file(ctx.orgB, ctx.orgB)), "B's id naming A's template under B's setting").toBe("42501");
  expect(sqlState(await file(ctx.orgA, ctx.orgB)), "B's id naming A's template under A's setting").toBe("42501");
  expect((await itemRows(ctx, created.id)).map((row) => row.title)).not.toContain(`${ctx.prefix}smuggled`);
}

/** `list` answers the organization's active and retired templates, each with its items in order, and none of B's. */
export async function listAnswersActiveAndRetiredOfTheOrganizationOnly(ctx: ChecklistTemplateFixtures): Promise<void> {
  const active = await ctx.svc.create(ctx.actor, body(ctx, "list-active"));
  const retired = await ctx.svc.create(ctx.actor, body(ctx, "list-retired"));
  await ctx.svc.update(ctx.actor, retired.id, ctx.orgA, { active: false });
  const inB = await ctx.svc.create(ctx.actor, body(ctx, "list-in-b", { organizationId: ctx.orgB }));

  const answer = await ctx.svc.list(ctx.orgA);
  expect(workOrderChecklistTemplatesResponseSchema.parse(answer)).toEqual(answer);
  expect(answer.items.every((t) => t.organizationId === ctx.orgA), "only A's templates").toBe(true);
  const ids = answer.items.map((t) => t.id);
  expect(ids).toContain(active.id);
  expect(ids).toContain(retired.id);
  expect(ids).not.toContain(inB.id);
  expect(answer.items.find((t) => t.id === retired.id)?.active).toBe(false);
  expect(answer.items.find((t) => t.id === active.id)?.items.map((i) => i.sortOrder)).toEqual([1, 2, 3]);

  const mine = answer.items.filter((t) => t.name.startsWith(ctx.prefix)).map((t) => t.name);
  expect(mine, "ordered by name").toEqual([...mine].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
}
