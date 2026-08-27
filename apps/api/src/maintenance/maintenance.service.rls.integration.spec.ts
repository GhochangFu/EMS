import { expect } from "vitest";
import pg from "pg";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { countingDb } from "../testing/counting-db";
import type {
  CreateMaintenanceScheduleBody,
  ListMaintenanceQuery,
  UpdateMaintenanceScheduleBody,
} from "./maintenance.schema";
import type { MaintenanceService } from "./maintenance.service";

/**
 * `E7.1b` — the org-stamping and silent-no-op proofs for `MaintenanceService`
 * against real, non-owner roles.
 *
 * The four maintenance write tables gain a `tenant_isolation` policy + `FORCE`
 * in `0047`. Constructing the service with a real `bms_tenant` connection is the
 * only proof its writes stamp `organization_id` under `withTenant` — the
 * owner/fleet connection bypasses row-level security and would pass regardless.
 *
 * These assertions also gate the failure the column change introduces: under
 * `FORCE`, an UPDATE whose row fails the policy `USING` clause affects zero rows
 * *without erroring*. So `updateSchedule` flips the schedule and the template in
 * one transaction, and `convertToWorkOrder` advances `next_due_at`; each of
 * those UPDATEs must actually land, not silently no-op and return 200. The
 * post-conditions here (both rows flipped; `next_due_at` moved) are what
 * discriminate a real tenant write from a silent no-op.
 */
export type MaintenanceRlsFixtures = {
  service: MaintenanceService;
  /** The real `bms_tenant` handle — for building a counting-wrapped service. */
  tenantDb: BmsDb;
  /** The real `bms_fleet` handle — for building a counting-wrapped service. */
  fleetDb: BmsDb;
  /** Rebuilds the service with swapped db handles (the counter probe). */
  makeService: (tenantDb: BmsDb, fleetDb: BmsDb) => MaintenanceService;
  /** A `bms_fleet` (BYPASSRLS) pool, for the verification reads only. */
  ownerPool: pg.Pool;
  organizationId: string;
  /** A seeded asset in `organizationId`. */
  assetId: string;
  /** An org-scoped actor whose email matches a seeded `bms.users` row. */
  scopedActor: Pick<JwtPayload, "sub" | "email">;
  /** Ids the assertions create, for the lifecycle file to clean up in FK order. */
  createdScheduleIds: string[];
  createdTemplateIds: string[];
  createdWorkOrderIds: string[];
  /** An asset in a second organization, outside the single-org caller's scope. */
  foreignAssetId: string;
  /** A seeded schedule on `assetId` (org A) — the two-org read must include it. */
  inScopeScheduleId: string;
  /** A seeded schedule on `foreignAssetId` (org B) — likewise. */
  foreignScheduleId: string;
};

/** A wide, filter-open read so both future-due seeded schedules are in range. */
const READ_QUERY = { dueState: "all", priority: "all", horizonDays: 120 } as ListMaintenanceQuery;

const INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A future `firstDueAt`, so the convert advance is `firstDueAt + intervalDays`. */
function firstDueAt(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString();
}

function scheduleDraft(
  ctx: MaintenanceRlsFixtures,
  title: string,
  offsetDays: number,
): CreateMaintenanceScheduleBody {
  return {
    assetId: ctx.assetId,
    title,
    description: undefined,
    category: "preventive",
    generationMode: "calendar",
    ownerTeam: undefined,
    vendorName: undefined,
    complianceRef: undefined,
    triggerSummary: undefined,
    safetyCritical: false,
    priority: "medium",
    estimatedMinutes: 60,
    intervalDays: INTERVAL_DAYS,
    firstDueAt: firstDueAt(offsetDays),
  };
}

const deactivate: UpdateMaintenanceScheduleBody = {
  active: false,
  reason: "E7.1b RLS deactivation",
};

async function createSchedule(
  ctx: MaintenanceRlsFixtures,
  title: string,
  offsetDays: number,
): Promise<{ id: string; templateId: string }> {
  const item = await ctx.service.createSchedule(
    scheduleDraft(ctx, title, offsetDays),
    ctx.scopedActor,
    [ctx.assetId],
  );
  ctx.createdScheduleIds.push(item.id);
  ctx.createdTemplateIds.push(item.templateId);
  return { id: item.id, templateId: item.templateId };
}

/**
 * A `createSchedule` under a real `bms_tenant` connection stamps both the
 * template's and the schedule's `organization_id` from the asset, and its audit
 * row resolves a non-NULL actor from the pre-tenant `fleetDb` identity read.
 */
export async function assertCreateStampsOrgAndActorUnderRealRls(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const { id, templateId } = await createSchedule(ctx, "E7.1b create stamp", 2);

  const schedule = await ctx.ownerPool.query<{ organization_id: string | null }>(
    "SELECT organization_id FROM bms.maintenance_schedules WHERE id = $1",
    [id],
  );
  expect(schedule.rows[0]?.organization_id, "schedule.org = the asset's org").toBe(
    ctx.organizationId,
  );

  const template = await ctx.ownerPool.query<{ organization_id: string | null }>(
    "SELECT organization_id FROM bms.maintenance_task_templates WHERE id = $1",
    [templateId],
  );
  expect(template.rows[0]?.organization_id, "template.org = the asset's org").toBe(
    ctx.organizationId,
  );

  const audit = await ctx.ownerPool.query<{ actor_id: string | null }>(
    `SELECT actor_id FROM bms.audit_log
      WHERE entity_type = 'maintenance_schedule' AND entity_id = $1
        AND action = 'maintenance_schedule_create'`,
    [id],
  );
  expect(audit.rows.length, "the create wrote one audit row").toBe(1);
  expect(
    audit.rows[0]?.actor_id,
    "the actor resolved on fleetDb, so audit_log.actor_id is not NULL",
  ).not.toBeNull();
}

/**
 * `updateSchedule(active:false)` flips the schedule and its template in one
 * `withTenant` transaction. The template UPDATE is keyed by `template_id` under
 * the schedule's org GUC; under `FORCE` a divergent org would make it a silent
 * no-op. This proves both rows actually flip.
 */
export async function assertDeactivateFlipsScheduleAndTemplateUnderRealRls(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const { id, templateId } = await createSchedule(ctx, "E7.1b deactivate", 2);

  await ctx.service.updateSchedule(id, deactivate, ctx.scopedActor, [ctx.assetId]);

  const schedule = await ctx.ownerPool.query<{ active: boolean }>(
    "SELECT active FROM bms.maintenance_schedules WHERE id = $1",
    [id],
  );
  expect(schedule.rows[0]?.active, "the schedule row was deactivated").toBe(false);

  const template = await ctx.ownerPool.query<{ active: boolean }>(
    "SELECT active FROM bms.maintenance_task_templates WHERE id = $1",
    [templateId],
  );
  expect(
    template.rows[0]?.active,
    "the template UPDATE landed under FORCE, not a silent no-op",
  ).toBe(false);
}

/**
 * `convertToWorkOrder` inserts a work order + a history row (both stamped) and
 * advances the schedule's `next_due_at` by `interval_days`. The advance UPDATE
 * runs under the schedule's org GUC; under `FORCE` a divergent org would leave
 * `next_due_at` unchanged and let the same occurrence convert again. This proves
 * the stamps propagate and the advance actually moved the row.
 */
export async function assertConvertStampsAndAdvancesUnderRealRls(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const { id } = await createSchedule(ctx, "E7.1b convert", 2);
  const before = await ctx.ownerPool.query<{ next_due_at: Date }>(
    "SELECT next_due_at FROM bms.maintenance_schedules WHERE id = $1",
    [id],
  );
  const originalDue = before.rows[0]!.next_due_at.getTime();

  const { workOrder } = await ctx.service.convertToWorkOrder(
    id,
    { notes: "E7.1b RLS convert" },
    ctx.scopedActor,
    [ctx.assetId],
  );
  ctx.createdWorkOrderIds.push(workOrder.id);

  const wo = await ctx.ownerPool.query<{ organization_id: string | null }>(
    "SELECT organization_id FROM bms.work_orders WHERE id = $1",
    [workOrder.id],
  );
  expect(wo.rows[0]?.organization_id, "work_order.org = the asset's org").toBe(
    ctx.organizationId,
  );

  const history = await ctx.ownerPool.query<{ organization_id: string | null }>(
    "SELECT organization_id FROM bms.maintenance_history WHERE work_order_id = $1",
    [workOrder.id],
  );
  expect(history.rows.length, "the convert wrote one history row").toBe(1);
  expect(
    history.rows[0]?.organization_id,
    "maintenance_history.org = the asset's org",
  ).toBe(ctx.organizationId);

  const after = await ctx.ownerPool.query<{ next_due_at: Date }>(
    "SELECT next_due_at FROM bms.maintenance_schedules WHERE id = $1",
    [id],
  );
  const advancedDue = after.rows[0]!.next_due_at.getTime();
  expect(
    advancedDue,
    "next_due_at advanced under FORCE, not a silent no-op",
  ).toBeGreaterThan(originalDue);
  expect(advancedDue, "next_due_at moved forward by exactly interval_days").toBe(
    originalDue + INTERVAL_DAYS * DAY_MS,
  );
}

/**
 * `E7.1c` — `createSchedule`'s post-write `getScheduleItem` read-back is folded
 * into the write's own `withTenant` transaction, so a single-org create opens
 * exactly one tenant transaction and zero fleet transactions. The read-back's
 * active-work-order guard (`getActiveWorkOrdersBySchedule`) is a display field,
 * not the cross-org duplicate guard, so it runs correctly under the write's org
 * GUC. Before E7.1c that guard ran on its own `fleetDb.transaction` — a revert
 * restores that one fleet transaction, so `fleet.transactions() === 0` is the
 * discriminating assertion.
 */
export async function assertCreateScheduleReadsBackInTenantTransaction(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  const item = await svc.createSchedule(
    scheduleDraft(ctx, "E7.1c create read-back", 3),
    ctx.scopedActor,
    [ctx.assetId],
  );
  ctx.createdScheduleIds.push(item.id);
  ctx.createdTemplateIds.push(item.templateId);
  expect(
    tenant.transactions(),
    "createSchedule writes and reads back in one tenant transaction",
  ).toBe(1);
  expect(
    fleet.transactions(),
    "the folded read-back (incl. the active-WO guard) opens no fleet transaction",
  ).toBe(0);
}

/**
 * `E7.1c` — `updateSchedule`'s post-write read-back is folded into the write's
 * `withTenant`, so a single-org update opens exactly one tenant transaction; the
 * pre-write existence read (`getScheduleItem`) is the only fleet transaction.
 * Before E7.1c the post-write `getScheduleItem` added a second fleet transaction
 * (its own `getActiveWorkOrdersBySchedule`), so this pins the fleet 2→1 drop.
 */
export async function assertUpdateScheduleReadsBackInTenantTransaction(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const { id } = await createSchedule(ctx, "E7.1c update read-back count", 3);

  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.updateSchedule(id, { active: false, reason: "E7.1c count" }, ctx.scopedActor, [
    ctx.assetId,
  ]);
  expect(
    tenant.transactions(),
    "updateSchedule writes and reads back in one tenant transaction",
  ).toBe(1);
  expect(
    fleet.transactions(),
    "only the pre-write existence read runs on fleet",
  ).toBe(1);
}

/**
 * `E7.1c` — the read-back's active-work-order display field resolves under the
 * tenant GUC. `getActiveWorkOrdersBySchedule` joins `maintenance_history ⋈
 * work_orders`, both `FORCE`-policied since `0047`; a silently-empty result under
 * RLS would drop `activeWorkOrderId` — a wrong-but-200. A fresh schedule has no
 * active work order, so the join is only really exercised over a converted one:
 * convert to create the open work order + history, then read the schedule back
 * via `updateSchedule` (its `readScheduleItem` runs under the write's org GUC) and
 * assert the open work order still resolves.
 */
export async function assertReadBackResolvesActiveWorkOrderUnderTenantGuc(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const { id } = await createSchedule(ctx, "E7.1c active-WO read-back", 3);
  const { workOrder } = await ctx.service.convertToWorkOrder(
    id,
    { notes: "E7.1c active-WO" },
    ctx.scopedActor,
    [ctx.assetId],
  );
  ctx.createdWorkOrderIds.push(workOrder.id);

  const updated = await ctx.service.updateSchedule(
    id,
    { active: false, reason: "E7.1c active-WO" },
    ctx.scopedActor,
    [ctx.assetId],
  );
  expect(
    updated.activeWorkOrderId,
    "the read-back resolves the open work order across maintenance_history ⋈ work_orders under the tenant GUC",
  ).toBe(workOrder.id);
}

/**
 * `E7.1c` — `convertToWorkOrder`'s post-write `getWorkOrder` read-back runs on
 * the **tenant** pool. Unlike `getScheduleItem`, `getWorkOrder` is a plain
 * `fleetDb.select` with no `fleetDb.transaction` for `countingDb` to see a fold
 * through, so the read-back runs in its own second tenant transaction — a
 * single-org convert opens two tenant transactions (the write, then the
 * read-back). The cross-org duplicate guard stays on `fleetDb`: exactly one
 * fleet transaction, before the write. A revert of the read-back to
 * `this.fleetDb.select` drops the tenant count to one.
 */
export async function assertConvertReadsBackOnTenantTransaction(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const created = await createSchedule(ctx, "E7.1c convert read-back", 3);

  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  const { workOrder } = await svc.convertToWorkOrder(
    created.id,
    { notes: "E7.1c convert read-back" },
    ctx.scopedActor,
    [ctx.assetId],
  );
  ctx.createdWorkOrderIds.push(workOrder.id);
  expect(
    tenant.transactions(),
    "convert writes then reads the work order back, both on the tenant pool",
  ).toBe(2);
  expect(
    fleet.transactions(),
    "only the cross-org duplicate guard runs on fleet, before the write",
  ).toBe(1);
}

/**
 * Decision 3: one `list` whose `assetIds` span two organizations returns BOTH
 * orgs' schedules — the run-time fleet fallback resolves across organizations. A
 * `withTenant(one org)` regression would drop the other org's rows.
 */
export async function assertMaintenanceListReturnsBothOrgsForTwoOrgActor(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const both = await ctx.service.list(READ_QUERY, [ctx.assetId, ctx.foreignAssetId]);
  const ids = both.items.map((i) => i.id);
  expect(ids, "org A's schedule is returned on the two-org path").toContain(ctx.inScopeScheduleId);
  expect(ids, "org B's schedule is returned on the same read (fleet fallback)").toContain(
    ctx.foreignScheduleId,
  );
  // Exactly the rows the filter allows (ADR 0043 ruling 3): the fleet path has no
  // GUC, so the assetIds WHERE is the ONLY isolation control, and the seed carries
  // schedules on other assets that dropping it would surface.
  expect(
    both.items.every((i) => [ctx.assetId, ctx.foreignAssetId].includes(i.assetId)),
    "the fleet read returns no schedule outside the passed assetIds",
  ).toBe(true);
}

/**
 * The single-organization tenant path (decision 1) actually returns the caller's
 * own schedule — not a silently-empty list — and excludes the other org's.
 */
export async function assertSingleOrgMaintenanceListReturnsOwnRow(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const own = await ctx.service.list(READ_QUERY, [ctx.assetId]);
  const ids = own.items.map((i) => i.id);
  expect(ids, "the single-org tenant read returns the caller's own schedule").toContain(
    ctx.inScopeScheduleId,
  );
  expect(ids, "the single-org read excludes the other org's schedule").not.toContain(
    ctx.foreignScheduleId,
  );
}

/**
 * The mechanism seam: a single-organization `list` opens exactly one **tenant**
 * transaction (`withReadScope` → `withTenant`; the `getActiveWorkOrdersBySchedule`
 * guard runs inside that same transaction, not a new one) and zero fleet
 * transactions. A revert to `this.fleetDb.select` in `list` drops the tenant
 * count to zero.
 */
export async function assertSingleOrgMaintenanceListRunsOnTenantTransaction(
  ctx: MaintenanceRlsFixtures,
): Promise<void> {
  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.list(READ_QUERY, [ctx.assetId]);
  expect(tenant.transactions(), "a single-org list opens one tenant transaction").toBe(1);
  expect(fleet.transactions(), "a single-org list opens no fleet transaction").toBe(0);
}
