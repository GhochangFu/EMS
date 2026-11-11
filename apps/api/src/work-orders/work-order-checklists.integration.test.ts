import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb, locations } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";
import { MaintenanceService } from "../maintenance/maintenance.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { SEEDED, jwtFor, primeSeededSubjects } from "../testing/seeded-subjects";
import { deleteFixtureUsers, deleteWorkOrderEvents } from "../testing/work-order-events-cleanup";
import {
  assertABlockedResolveWritesNothing,
  assertAFailedAuditLeavesNoTaskChange,
  assertAFullChecklistRefusesOneMoreAndTheAddAuditHoldsNoTitle,
  assertATaskCannotPointAtAnotherOrganizationsTemplateItem,
  assertAForeignSettingCannotReadOrFileATask,
  assertAMandatoryItemBlocksResolveThenPasses,
  assertAReorderIntoResolvedIsRefusedAndWritesNothing,
  assertAResolvedCardMayStillBeReordered,
  assertAResolvedOrClosedTicketFreezesItsChecklist,
  assertAScheduleRefusesAnUnusableTemplateAndConvertSkipsARetiredOne,
  assertAScheduleUpdateSetsKeepsAndClearsItsTemplate,
  assertATaskChangeWritesAnEventWithNoNoteText,
  assertATaskOfAnotherWorkOrderIsNotFound,
  assertATaskResultStampsAndClears,
  assertATaskWriteOutsideTheScopeIsNotFound,
  assertATemplateEditLeavesTheTicketUnchanged,
  assertATicketWithNoMandatoryItemResolves,
  assertAnItemAddedByHandGoesLast,
  assertAnUnchangedTaskWritesNothing,
  assertAnUnusableTemplateIsRefusedWithOneSentence,
  assertConvertCopiesTheSchedulesChecklist,
  assertCreateCopiesTheTemplateInOrder,
  assertCreateWithoutATemplateHasNoChecklist,
  assertNotApplicableStampsAndANoteAloneDoesNot,
  assertTheCountersAreRightForTwoTicketsAtOnce,
  assertTheCreateAuditRowNamesTheTemplate,
  assertTheDetailCarriesTheChecklist,
  assertTheFleetRoleCannotFileACrossOrganizationTask,
  assertTheResultCheckRefusesAnUnknownValue,
  assertTheSlaOverrideGateReadsTheDatabaseRole,
  assertTheTaskAuditRowHoldsNoNoteText,
  assertTheTemplateListFitsTheAsset,
  assertTheTemplateListIsEmptyOutsideTheScope,
  assertUpperCaseIdsAreTheSameRows,
  type ChecklistFixtures,
  makeTemplate,
} from "./work-order-checklists.integration.spec";
import { WorkOrderTaskAddService } from "./work-order-task-add.service";
import { WorkOrderTasksService } from "./work-order-tasks.service";
import { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decision 4) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "work-order checklists against real, non-owner roles",
  because:
    "the checklist's guarantees live in Postgres, not in code: the re-created work_order_tasks policy " +
    "refuses a task filed against another organization's work order, the composite foreign key says " +
    "the same for bms_fleet, and the resolve gate is only sound under a real row lock inside a real " +
    "transaction. Only real pool roles prove any of them.",
});

// Per-run fixture prefix (F4.65): randomUUID() sits in PREFIX's own declaration because
// the isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "E31-CHK-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
const OPERATOR_EMAIL = `${PREFIX.toLowerCase()}operator@bms.invalid`;

/**
 * Deletes everything this suite made for the assets and templates matching `like`,
 * children first, except the assets and locations themselves: the callers delete those
 * with the prefix written out, where the fixture-isolation invariant can read it. `olderThan` bounds the stale sweep to rows no run still in flight
 * could own; the run's own cleanup passes none.
 *
 * The timeline is append-only for the fleet role, so its rows go through the superuser
 * helper. The fleet role may delete tasks, templates and items (migration 0145 revokes
 * nothing there).
 */
async function deleteFixtures(fleet: pg.Pool, superuserUrl: string, like: string, olderThanMinutes?: number): Promise<void> {
  const minutes = olderThanMinutes ?? 0;
  const ownAssets = `SELECT id FROM bms.assets WHERE code LIKE $1 AND created_at <= now() - make_interval(mins => $2::integer)`;
  const ownWorkOrders = `SELECT id FROM bms.work_orders WHERE asset_id IN (${ownAssets})`;
  const ownTemplates = `SELECT id FROM bms.work_order_checklist_templates WHERE name LIKE $1 AND created_at <= now() - make_interval(mins => $2::integer)`;
  const args = [like, minutes];

  await deleteWorkOrderEvents(superuserUrl, { assetCodeLike: like, olderThanMinutes: minutes });
  // audit_log has no FK: delete exactly the rows about this suite's own tickets and schedules.
  await fleet.query(
    `DELETE FROM bms.audit_log
      WHERE (entity_type = 'work_order' AND entity_id IN (${ownWorkOrders}))
         OR (entity_type = 'maintenance_schedule' AND entity_id IN (
               SELECT s.id FROM bms.maintenance_schedules s
                 JOIN bms.maintenance_task_templates m ON m.id = s.template_id
                WHERE m.asset_id IN (${ownAssets})))`,
    args,
  );
  await fleet.query(`DELETE FROM bms.work_order_tasks WHERE work_order_id IN (${ownWorkOrders})`, args);
  await fleet.query(`DELETE FROM bms.maintenance_history WHERE asset_id IN (${ownAssets})`, args);
  await fleet.query(`DELETE FROM bms.work_orders WHERE asset_id IN (${ownAssets})`, args);
  await fleet.query(
    `DELETE FROM bms.maintenance_schedules
      WHERE template_id IN (SELECT id FROM bms.maintenance_task_templates WHERE asset_id IN (${ownAssets}))`,
    args,
  );
  await fleet.query(`DELETE FROM bms.maintenance_task_templates WHERE asset_id IN (${ownAssets})`, args);
  await fleet.query(`DELETE FROM bms.work_order_checklist_template_items WHERE template_id IN (${ownTemplates})`, args);
  await fleet.query(
    `DELETE FROM bms.work_order_checklist_templates WHERE name LIKE $1 AND created_at <= now() - make_interval(mins => $2::integer)`,
    args,
  );
}

/**
 * Reaps rows a *killed* earlier run of this suite committed but never cleaned. Age-bounded,
 * so a concurrent instance's rows (seconds old) are out of reach. Non-fatal: per-run
 * codes mean a leftover cannot collide with this run.
 */
async function sweepStaleRuns(fleet: pg.Pool, superuserUrl: string): Promise<void> {
  try {
    await deleteFixtures(fleet, superuserUrl, `${FAMILY}%`, 30);
    await fleet.query(`DELETE FROM bms.assets WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [`${FAMILY}%`]);
    await fleet.query(`DELETE FROM bms.locations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [
      `${FAMILY}%`,
    ]);
    await deleteFixtureUsers(superuserUrl, { emailLike: `${FAMILY.toLowerCase()}%`, olderThanMinutes: 30 });
  } catch (err) {
    process.stderr.write(
      `[E3.1] could not sweep stale ${FAMILY} rows: ${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("E3.1 — work-order checklists under real RLS", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let ctx: ChecklistFixtures;
  let operatorUserId = "";

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
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E3.1");
    await primeSeededSubjects(fleetPool);
    const actor = jwtFor(SEEDED.organizationAdmin, "organization_admin");

    const user = await fleetPool.query<{ id: string }>("SELECT id FROM bms.users WHERE email = $1 LIMIT 1", [
      SEEDED.organizationAdmin,
    ]);
    const actorUserId = user.rows[0]?.id;
    if (!actorUserId) throw new Error(`E3.1: ${SEEDED.organizationAdmin} is not seeded — run pnpm db:seed.`);

    await sweepStaleRuns(fleetPool, resolveIntegrationRoleUrl(url, "superuser", process.env));

    // The organization admin's own organization. Every count this suite asserts is over
    // rows of its own tickets or its own asset, so sharing the organization is safe.
    const org = await fleetPool.query<{ id: string }>(
      "SELECT organization_id AS id FROM bms.user_organization_access WHERE user_id = $1 LIMIT 1",
      [actorUserId],
    );
    if (!org.rows[0]) throw new Error(`E3.1: ${SEEDED.organizationAdmin} has no organization grant — run pnpm db:seed.`);
    const organizationId = org.rows[0].id;
    const other = await fleetPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, code LIMIT 1",
      [organizationId],
    );
    if (!other.rows[0]) throw new Error("E3.1: need a second seeded organization — run pnpm db:seed.");
    const foreignOrgId = other.rows[0].id;

    // The suite's own operator, for the SLA override gate: no operator is seeded, and a
    // seeded user's role must never be changed.
    const operator = await fleetPool.query<{ id: string }>(
      "INSERT INTO bms.users (email, display_name, role, organization_id) VALUES ($1, 'E3.1 Fixture Operator', 'operator', $2) RETURNING id",
      [OPERATOR_EMAIL, organizationId],
    );
    operatorUserId = operator.rows[0]?.id ?? "";
    if (!operatorUserId) throw new Error("E3.1: the fixture operator was not created");

    const domains = await fleetPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE code IN ('electrical', 'hvac')",
    );
    if (domains.rows.length !== 2) throw new Error("E3.1: the electrical and hvac domains are not seeded — run pnpm db:seed.");

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const ids = await withTenant(tenantDb, organizationId, async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({
          organizationId,
          code: `${PREFIX}LOC`,
          slug: `${PREFIX.toLowerCase()}loc`,
          name: "E3.1 checklist location",
          type: "smoc_campus",
          latitude: 0,
          longitude: 0,
          active: true,
          updatedAt: sql`now()`,
        })
        .returning({ id: locations.id });
      const asset = async (suffix: string): Promise<string> => {
        const [row] = await tx
          .insert(assets)
          .values({
            organizationId,
            code: `${PREFIX}${suffix}`,
            name: `E3.1 ${suffix}`,
            siteName: "E3.1 Site",
            locationId: loc.id,
            domain: "electrical",
            active: true,
          })
          .returning({ id: assets.id });
        return row.id;
      };
      return { assetId: await asset("A1"), otherAssetId: await asset("A2") };
    });

    const one: Array<[string, boolean]> = [["Inspect", false]];
    const templates = {
      templateId: await makeTemplate(fleetPool, {
        organizationId,
        name: `${PREFIX}every domain`,
        domain: null,
        items: [
          ["Isolate", true],
          ["Photograph", false],
          ["Test", true],
        ],
      }),
      electricalTemplateId: await makeTemplate(fleetPool, { organizationId, name: `${PREFIX}electrical`, domain: "electrical", items: one }),
      hvacTemplateId: await makeTemplate(fleetPool, { organizationId, name: `${PREFIX}hvac`, domain: "hvac", items: one }),
      retiredTemplateId: await makeTemplate(fleetPool, { organizationId, name: `${PREFIX}retired`, domain: null, active: false, items: one }),
      foreignTemplateId: await makeTemplate(fleetPool, { organizationId: foreignOrgId, name: `${PREFIX}foreign`, domain: null, items: one }),
    };

    const failingAudit = {
      write: async (): Promise<never> => {
        throw new Error("audit is down");
      },
      writeMany: async (): Promise<never> => {
        throw new Error("audit is down");
      },
    } as unknown as MasterDataAuditService;
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const tasks = (a: MasterDataAuditService, t: BmsDb, f: BmsDb): WorkOrderTasksService => new WorkOrderTasksService(f, t, a);

    ctx = {
      svc: new WorkOrdersService(fleetDb, tenantDb, audit),
      tasks: tasks(audit, tenantDb, fleetDb),
      taskAdd: new WorkOrderTaskAddService(fleetDb, tenantDb, audit),
      tasksWithFailingAudit: tasks(failingAudit, tenantDb, fleetDb),
      taskAddWithFailingAudit: new WorkOrderTaskAddService(fleetDb, tenantDb, failingAudit),
      maintenance: new MaintenanceService(fleetDb, tenantDb, audit),
      access: new AccessControlService(createDb(authPool), fleetDb),
      operatorUserId,
      operatorEmail: OPERATOR_EMAIL,
      tenantPool,
      fleetPool,
      actor,
      actorUserId,
      organizationId,
      foreignOrgId,
      prefix: PREFIX,
      ...ids,
      ...templates,
    };
  });

  afterAll(async () => {
    if (fleetPool) {
      await deleteFixtures(fleetPool, resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), `${PREFIX}%`);
      await fleetPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
      await fleetPool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${PREFIX}%`]);
      if (operatorUserId) {
        // The fleet role cannot delete a user. Nothing references this one: it wrote nothing.
        await deleteFixtureUsers(resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env), {
          userId: operatorUserId,
        });
      }
    }
    await Promise.all([tenantPool, fleetPool, authPool].filter(Boolean).map((p) => p.end()));
  });

  describe("the copy at create", () => {
    it("copies the template's items in order, with mandatory and where each came from", async () => {
      await assertCreateCopiesTheTemplateInOrder(ctx);
    });

    it("names the template and the item count in the create audit row", async () => {
      await assertTheCreateAuditRowNamesTheTemplate(ctx);
    });

    it("gives a ticket created without a template no checklist", async () => {
      await assertCreateWithoutATemplateHasNoChecklist(ctx);
    });

    it("leaves the ticket's tasks unchanged when the template is edited afterwards", async () => {
      await assertATemplateEditLeavesTheTicketUnchanged(ctx);
    });

    it("refuses a foreign, retired, wrong-domain or unknown template with one sentence, and creates nothing", async () => {
      await assertAnUnusableTemplateIsRefusedWithOneSentence(ctx);
    });
  });

  describe("task writes", () => {
    it("stamps who and when on done, and clears both on pending", async () => {
      await assertATaskResultStampsAndClears(ctx);
    });

    it("stamps not_applicable like done, and moves no stamp and writes no event for a note alone", async () => {
      await assertNotApplicableStampsAndANoteAloneDoesNot(ctx);
    });

    it("writes a task_updated event that holds no note text", async () => {
      await assertATaskChangeWritesAnEventWithNoNoteText(ctx);
    });

    it("writes an audit row that holds no note text", async () => {
      await assertTheTaskAuditRowHoldsNoNoteText(ctx);
    });

    it("treats an id typed in upper case as the same item and the same asset", async () => {
      await assertUpperCaseIdsAreTheSameRows(ctx);
    });

    it("writes nothing for a change that changes nothing", async () => {
      await assertAnUnchangedTaskWritesNothing(ctx);
    });

    it("puts an item added by hand last", async () => {
      await assertAnItemAddedByHandGoesLast(ctx);
    });

    it("refuses one more item on a full checklist (409), and keeps the title out of the add audit row", async () => {
      await assertAFullChecklistRefusesOneMoreAndTheAddAuditHoldsNoTitle(ctx);
    });

    it("answers 404 for a task id of another work order", async () => {
      await assertATaskOfAnotherWorkOrderIsNotFound(ctx);
    });

    it("answers 404 for a ticket outside the caller's asset scope", async () => {
      await assertATaskWriteOutsideTheScopeIsNotFound(ctx);
    });

    it("leaves no task change and no event when the audit write fails", async () => {
      await assertAFailedAuditLeavesNoTaskChange(ctx);
    });
  });

  describe("row security (ruling P9)", () => {
    it("refuses a task filed under another organization's setting, and shows it none", async () => {
      await assertAForeignSettingCannotReadOrFileATask(ctx);
    });

    it("refuses a cross-organization task on the fleet role by the composite foreign key", async () => {
      await assertTheFleetRoleCannotFileACrossOrganizationTask(ctx);
    });

    it("refuses a task that points at another organization's template item", async () => {
      await assertATaskCannotPointAtAnotherOrganizationsTemplateItem(ctx);
    });

    it("refuses a result outside the vocabulary", async () => {
      await assertTheResultCheckRefusesAnUnknownValue(ctx);
    });
  });

  describe("the resolve gate and the reorder refusal", () => {
    it("blocks resolved while a mandatory item is pending (409), then passes", async () => {
      await assertAMandatoryItemBlocksResolveThenPasses(ctx);
    });

    it("writes no audit row and no event for a blocked resolve", async () => {
      await assertABlockedResolveWritesNothing(ctx);
    });

    it("resolves a ticket with no mandatory item as before", async () => {
      await assertATicketWithNoMandatoryItemResolves(ctx);
    });

    it("freezes the checklist of a resolved, closed or cancelled ticket (409)", async () => {
      await assertAResolvedOrClosedTicketFreezesItsChecklist(ctx);
    });

    it("refuses a reorder into resolved with 400 and writes nothing (ruling P1)", async () => {
      await assertAReorderIntoResolvedIsRefusedAndWritesNothing(ctx);
    });

    it("still reorders a card that is already resolved", async () => {
      await assertAResolvedCardMayStillBeReordered(ctx);
    });
  });

  describe("reads", () => {
    it("counts the checklist right for two tickets at once", async () => {
      await assertTheCountersAreRightForTwoTicketsAtOnce(ctx);
    });

    it("carries the checklist on the detail, in order", async () => {
      await assertTheDetailCarriesTheChecklist(ctx);
    });

    it("lists the active templates that fit the asset (ruling P6)", async () => {
      await assertTheTemplateListFitsTheAsset(ctx);
    });

    it("lists nothing for an asset outside the read scope", async () => {
      await assertTheTemplateListIsEmptyOutsideTheScope(ctx);
    });
  });

  describe("the per-ticket SLA override (owner ruling, 2026-11-11)", () => {
    it("refuses an operator by the database role, whatever the token claims", async () => {
      await assertTheSlaOverrideGateReadsTheDatabaseRole(ctx);
    });
  });

  describe("maintenance schedules", () => {
    it("copies the schedule's checklist onto the converted work order", async () => {
      await assertConvertCopiesTheSchedulesChecklist(ctx);
    });

    it("refuses an unusable template on a schedule, and skips a retired one at convert", async () => {
      await assertAScheduleRefusesAnUnusableTemplateAndConvertSkipsARetiredOne(ctx);
    });

    it("sets, keeps and clears a schedule's template through the update", async () => {
      await assertAScheduleUpdateSetsKeepsAndClearsItsTemplate(ctx);
    });
  });
});
