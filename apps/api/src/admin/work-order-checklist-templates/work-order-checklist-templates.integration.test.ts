import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { SEEDED, jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  aDuplicateNameInTheOrganizationIs409,
  aFailedAuditLeavesNothing,
  anUnknownDomainIs400AndAnUnknownOrganization404,
  bsSettingSeesAndFilesNoneOfAsRows,
  type ChecklistTemplateFixtures,
  createStoresTheTemplateAndItsItemsInOrder,
  eachWriteIsAuditedOnce,
  listAnswersActiveAndRetiredOfTheOrganizationOnly,
  updateRenamesRetiresAndReplacesTheItems,
} from "./work-order-checklist-templates.integration.spec";
import { WorkOrderChecklistTemplatesAdminService } from "./work-order-checklist-templates.service";

/**
 * `E3.1` (ADR 0122 decision 4.2, plan T3.3) — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the pools, the per-run prefix and the cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "work-order checklist template admin service against real, non-owner roles",
  because:
    "the template name is unique per organization only through a lower(name) index, the items " +
    "policy's parent check refuses an item filed against another organization's template, and the " +
    "template, its items and its audit row commit or roll back as one transaction. None of that " +
    "exists in a mocked database, and FORCE row security binds only bms_tenant.",
});

// Per-run fixture prefix (F4.65): randomUUID() sits in PREFIX's own declaration because
// the isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "E31-CKL-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}-`;

/**
 * Deletes the templates whose name matches `like` (and, when `olderThanMinutes` is set,
 * only those that old): their audit rows, their items, then them. On the fleet pool,
 * which has BYPASSRLS, so one statement reaches every organization's rows.
 */
async function deleteTemplates(fleet: pg.Pool, like: string, olderThanMinutes?: number): Promise<void> {
  const age = olderThanMinutes === undefined ? "" : ` AND created_at < now() - make_interval(mins => ${olderThanMinutes})`;
  const { rows } = await fleet.query<{ id: string }>(
    `SELECT id FROM bms.work_order_checklist_templates WHERE name LIKE $1${age}`,
    [like],
  );
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await fleet.query("DELETE FROM bms.work_order_checklist_template_items WHERE template_id = ANY($1::uuid[])", [ids]);
  await fleet.query("DELETE FROM bms.work_order_checklist_templates WHERE id = ANY($1::uuid[])", [ids]);
  // audit_log has no foreign key: delete exactly the rows about this suite's templates.
  await fleet.query(
    "DELETE FROM bms.audit_log WHERE entity_type = 'work_order_checklist_template' AND entity_id = ANY($1::uuid[])",
    [ids],
  );
}

/**
 * Reaps rows a *killed* earlier run committed and never cleaned. Age-bounded to 30
 * minutes, so a concurrent instance's rows (seconds old) are out of reach. Non-fatal:
 * per-run names mean a leftover cannot collide with this run.
 */
async function sweepStaleRuns(fleet: pg.Pool): Promise<void> {
  try {
    await deleteTemplates(fleet, `${FAMILY}%`, 30);
  } catch (err) {
    process.stderr.write(
      `[E3.1] could not sweep stale ${FAMILY} templates: ${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture names are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("E3.1 — work-order checklist templates under real RLS", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: ChecklistTemplateFixtures;

  beforeAll(async () => {
    const url = connectionString as string;
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E3.1",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E3.1",
    );
    await primeSeededSubjects(fleetPool);
    await sweepStaleRuns(fleetPool);

    // A is the seeded organization admin's organization; B is another seeded one. The
    // suite only adds prefixed templates to them, never changes them.
    const orgA = await fleetPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        ORDER BY uoa.organization_id
        LIMIT 1`,
      [SEEDED.organizationAdmin],
    );
    if (!orgA.rows[0]) throw new Error(`E3.1: ${SEEDED.organizationAdmin} has no organization grant — run pnpm db:seed.`);
    const orgB = await fleetPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, code LIMIT 1",
      [orgA.rows[0].id],
    );
    if (!orgB.rows[0]) throw new Error("E3.1: need a second seeded organization — run pnpm db:seed.");
    const domains = await fleetPool.query<{ code: string }>("SELECT code FROM bms.asset_domains ORDER BY code LIMIT 2");
    if (domains.rows.length < 2) throw new Error("E3.1: asset domains are not seeded — run pnpm db:seed.");

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const failingAudit = {
      write: async (): Promise<never> => {
        throw new Error("audit is down");
      },
      writeMany: async (): Promise<never> => {
        throw new Error("audit is down");
      },
    } as unknown as MasterDataAuditService;
    ctx = {
      svc: new WorkOrderChecklistTemplatesAdminService(fleetDb, tenantDb, new MasterDataAuditService(tenantDb, fleetDb)),
      svcWithFailingAudit: new WorkOrderChecklistTemplatesAdminService(fleetDb, tenantDb, failingAudit),
      tenantDb,
      fleetPool,
      actor: jwtFor(SEEDED.globalAdmin, "admin"),
      orgA: orgA.rows[0].id,
      orgB: orgB.rows[0].id,
      domain: domains.rows[0]?.code ?? "",
      otherDomain: domains.rows[1]?.code ?? "",
      prefix: PREFIX,
    };
  });

  afterAll(async () => {
    if (fleetPool) {
      await deleteTemplates(fleetPool, `${PREFIX}%`);
    }
    await Promise.all([tenantPool, fleetPool].filter(Boolean).map((p) => p.end()));
  });

  it("stores the template and its items in order, and answers a contract-valid read-back", async () => {
    await createStoresTheTemplateAndItsItemsInOrder(ctx);
  });

  it("answers 409 for a name already used in the organization, in any letter case", async () => {
    await aDuplicateNameInTheOrganizationIs409(ctx);
  });

  it("answers 400 for an unknown domain and 404 for an unknown organization", async () => {
    await anUnknownDomainIs400AndAnUnknownOrganization404(ctx);
  });

  it("renames, changes the domain, retires and replaces the items on update", async () => {
    await updateRenamesRetiresAndReplacesTheItems(ctx);
  });

  it("leaves no template and no item when the audit write fails", async () => {
    await aFailedAuditLeavesNothing(ctx);
  });

  it("writes one audit row per write, with counts and no item titles", async () => {
    await eachWriteIsAuditedOnce(ctx);
  });

  it("keeps A's templates and items out of B's setting and refuses cross-organization items", async () => {
    await bsSettingSeesAndFilesNoneOfAsRows(ctx);
  });

  it("lists the organization's active and retired templates and none of another's", async () => {
    await listAnswersActiveAndRetiredOfTheOrganizationOnly(ctx);
  });
});
