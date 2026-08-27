import { expect } from "vitest";
import pg from "pg";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { countingDb } from "../testing/counting-db";
import type { WorkOrdersService } from "./work-orders.service";

/**
 * `E7.1b` — the org-stamping/actor-resolution proof for the work-orders write
 * path, plus the decision-1+3 read-routing proof for `list`, against real,
 * non-owner roles.
 *
 * `work_orders` gained an `organization_id` column (migration `0046`, org =
 * `asset_id → assets.org`) and a `tenant_isolation` policy + `FORCE` in `0047`.
 * The three writers — `create`, `updateStatus`, `reorder` — run inside
 * `withTenant`, and `create` stamps the column. `list` reads through
 * `withReadScope`: single-organization → `withTenant` (decision 1), admin or
 * multi-organization → `fleetDb` (decisions 2/3). Constructing the service with a
 * real `bms_tenant`/`bms_fleet` pair is the only proof any of this holds under
 * the roles the deployment uses; the owner connection bypasses row-level
 * security and would pass regardless.
 *
 * The actor assertion is load-bearing: `resolveActorId` reads `bms.users`, which
 * after `0047` is invisible to the bare tenant pool for a scoped user. Reading
 * it on `fleetDb` is what keeps `created_by` populated — a NULL there is exactly
 * the silent actor-loss the plan's Task-4 finding describes.
 */
export type WorkOrdersRlsFixtures = {
  svc: WorkOrdersService;
  /** The real `bms_tenant` handle — for building a counting-wrapped service. */
  tenantDb: BmsDb;
  /** The real `bms_fleet` handle — for building a counting-wrapped service. */
  fleetDb: BmsDb;
  /** Rebuilds the service with swapped db handles (the counter probe). */
  makeService: (tenantDb: BmsDb, fleetDb: BmsDb) => WorkOrdersService;
  ownerPool: pg.Pool;
  organizationId: string;
  /** A hand-created asset in that org, the work order's parent. */
  assetId: string;
  /** The acting user's row id — `created_by`/`actor_id` must resolve to it. */
  actorUserId: string;
  /** An asset in a second organization, outside the single-org caller's scope. */
  foreignAssetId: string;
  /** A seeded work order on `assetId` (org A) — the two-org read must include it. */
  inScopeWorkOrderId: string;
  /** A seeded work order on `foreignAssetId` (org B) — likewise. */
  foreignWorkOrderId: string;
};

async function workOrderRow(
  ownerPool: pg.Pool,
  id: string,
): Promise<{ organization_id: string | null; created_by: string | null; status: string; sort_order: number } | undefined> {
  const { rows } = await ownerPool.query<{
    organization_id: string | null;
    created_by: string | null;
    status: string;
    sort_order: number;
  }>(
    "SELECT organization_id, created_by, status, sort_order FROM bms.work_orders WHERE id = $1",
    [id],
  );
  return rows[0];
}

/**
 * `create` stamps the asset's org and resolves the actor; `updateStatus` and
 * `reorder` then run under the tenant GUC and leave the org untouched. Returns
 * the created id so the lifecycle file can clean it up.
 */
export async function assertWorkOrderWritesStampOrgUnderRealRls(
  ctx: WorkOrdersRlsFixtures,
  actor: Pick<JwtPayload, "sub" | "email">,
): Promise<string> {
  const { svc, ownerPool, organizationId, assetId, actorUserId } = ctx;

  const created = await svc.create(
    { assetId, title: "E7.1b work order", priority: "medium" },
    actor,
    [assetId],
  );
  expect(created.assetId).toBe(assetId);

  const afterCreate = await workOrderRow(ownerPool, created.id);
  expect(afterCreate?.organization_id, "create stamps the asset's org").toBe(organizationId);
  expect(afterCreate?.created_by, "the actor resolves under bms_fleet, not NULL").toBe(
    actorUserId,
  );
  expect(afterCreate?.status).toBe("open");

  const progressed = await svc.updateStatus(
    created.id,
    { status: "in_progress", sortOrder: 3 },
    actor,
    [assetId],
  );
  expect(progressed.status).toBe("in_progress");

  const afterUpdate = await workOrderRow(ownerPool, created.id);
  expect(afterUpdate?.status).toBe("in_progress");
  expect(afterUpdate?.sort_order).toBe(3);
  // The org is fixed for the life of the row and the tenant-wrapped update must
  // not disturb it.
  expect(afterUpdate?.organization_id).toBe(organizationId);

  const reordered = await svc.reorder(
    { items: [{ id: created.id, status: "in_progress", sortOrder: 7 }] },
    actor,
    [assetId],
  );
  expect(reordered.items[0]?.sortOrder).toBe(7);

  const afterReorder = await workOrderRow(ownerPool, created.id);
  expect(afterReorder?.sort_order).toBe(7);
  expect(afterReorder?.organization_id).toBe(organizationId);

  return created.id;
}

/**
 * Decision 3: one `list` whose `assetIds` span two organizations returns BOTH
 * orgs' work orders — the run-time fleet fallback resolves across organizations.
 * A `withTenant(one org)` regression would drop the other org's rows.
 */
export async function assertWorkOrderListReturnsBothOrgsForTwoOrgActor(
  ctx: WorkOrdersRlsFixtures,
): Promise<void> {
  const both = await ctx.svc.list({ limit: 100, assetIds: [ctx.assetId, ctx.foreignAssetId] });
  const ids = both.items.map((i) => i.id);
  expect(ids, "org A's work order is returned on the two-org path").toContain(
    ctx.inScopeWorkOrderId,
  );
  expect(ids, "org B's work order is returned on the same read (fleet fallback)").toContain(
    ctx.foreignWorkOrderId,
  );
  // Exactly the rows the filter allows (ADR 0043 ruling 3): the fleet path has no
  // GUC, so the assetIds WHERE is the ONLY isolation control, and the seed carries
  // work orders on other assets that dropping it would surface.
  expect(
    both.items.every((i) => [ctx.assetId, ctx.foreignAssetId].includes(i.assetId)),
    "the fleet read returns no work order outside the passed assetIds",
  ).toBe(true);
}

/**
 * The single-organization tenant path (decision 1) actually returns the caller's
 * own row — not a silently-empty list — and excludes the other org's, under the
 * org GUC and the assetIds filter both.
 */
export async function assertSingleOrgWorkOrderListReturnsOwnRow(
  ctx: WorkOrdersRlsFixtures,
): Promise<void> {
  const own = await ctx.svc.list({ limit: 100, assetIds: [ctx.assetId] });
  const ids = own.items.map((i) => i.id);
  expect(ids, "the single-org tenant read returns the caller's own work order").toContain(
    ctx.inScopeWorkOrderId,
  );
  expect(ids, "the single-org read excludes the other org's work order").not.toContain(
    ctx.foreignWorkOrderId,
  );
}

/**
 * The mechanism seam: a single-organization `list` opens exactly one **tenant**
 * transaction (`withReadScope` → `withTenant`) and zero fleet transactions (org
 * resolution uses `fleetDb.select`, not `.transaction`). A revert to
 * `this.fleetDb.select` in `list` drops the tenant count to zero.
 */
export async function assertSingleOrgWorkOrderListRunsOnTenantTransaction(
  ctx: WorkOrdersRlsFixtures,
): Promise<void> {
  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.list({ limit: 100, assetIds: [ctx.assetId] });
  expect(tenant.transactions(), "a single-org list opens one tenant transaction").toBe(1);
  expect(fleet.transactions(), "a single-org list opens no fleet transaction").toBe(0);
}

/**
 * `E7.1c` — the private post-write read-back (`getById`) runs on the **tenant**
 * pool, not the unconditional fleet pool (ADR 0043 decision 1). A single-org
 * `create` opens one tenant transaction for the write and a second for the
 * read-back, and zero fleet transactions (org and actor resolution use
 * `fleetDb.select`, not `.transaction`).
 *
 * Unlike the rules/maintenance folds, `work_orders` has no `fleetDb.transaction`
 * on any path, so `countingDb` cannot observe the read-back as a *fleet*
 * transaction disappearing. Routing the read-back through its own `withTenant`
 * (rather than folding it into the write transaction, the way `acknowledge`
 * does) is what makes the routing assertable with the existing `countingDb`
 * primitive: a revert of the read-back to `this.fleetDb.select` drops the tenant
 * count from two to one.
 */
export async function assertWorkOrderCreateReadsBackOnTenantTransaction(
  ctx: WorkOrdersRlsFixtures,
  actor: Pick<JwtPayload, "sub" | "email">,
): Promise<void> {
  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.create(
    { assetId: ctx.assetId, title: "E7.1c WO read-back", priority: "medium" },
    actor,
    [ctx.assetId],
  );
  expect(
    tenant.transactions(),
    "create writes then reads back, both on the tenant pool",
  ).toBe(2);
  expect(fleet.transactions(), "a single-org create opens no fleet transaction").toBe(0);
}

/**
 * `E7.1c` — `updateStatus` reads back the row it just mutated, on the **tenant**
 * pool. This is the path where a wrongly-scoped read-back would be a 404 *after* a
 * committed write, so the assertion is two-sided: the returned item carries the
 * mutation (the read-back saw the row under its own GUC — not a spurious 404), and
 * the counts show two tenant transactions (write + read-back) with the pre-write
 * existence/terminal check the only fleet transaction. A read-back left on
 * `this.fleetDb.select` drops the tenant count to one.
 */
export async function assertUpdateStatusReadsBackOnTenantTransaction(
  ctx: WorkOrdersRlsFixtures,
  actor: Pick<JwtPayload, "sub" | "email">,
): Promise<void> {
  const wo = await ctx.svc.create(
    { assetId: ctx.assetId, title: "E7.1c updateStatus read-back", priority: "medium" },
    actor,
    [ctx.assetId],
  );

  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  const updated = await svc.updateStatus(
    wo.id,
    { status: "in_progress", sortOrder: 2 },
    actor,
    [ctx.assetId],
  );
  expect(
    updated.status,
    "the read-back returns the mutated row under the tenant GUC, not a 404 after a committed write",
  ).toBe("in_progress");
  expect(
    tenant.transactions(),
    "updateStatus writes then reads back, both on the tenant pool",
  ).toBe(2);
  expect(
    fleet.transactions(),
    "only the pre-write existence/terminal check runs on fleet",
  ).toBe(1);
}

/**
 * `E7.1c` — `reorder` reads back N work orders, and they run in ONE shared tenant
 * transaction, not one per id. A two-item reorder therefore opens exactly two
 * tenant transactions (the write, then the batch read-back) and the count does
 * not grow with batch size. This pins the batch invariant: a revert to a per-id
 * `withTenant` read-back would make it `1 + items.length`, and a revert to
 * `this.fleetDb.select` would drop it to one.
 */
export async function assertReorderReadsBackInOneTenantTransaction(
  ctx: WorkOrdersRlsFixtures,
  actor: Pick<JwtPayload, "sub" | "email">,
): Promise<void> {
  // Two work orders in the same org, created on the un-counted service so only
  // the reorder call below is measured.
  const a = await ctx.svc.create(
    { assetId: ctx.assetId, title: "E7.1c reorder A", priority: "medium" },
    actor,
    [ctx.assetId],
  );
  const b = await ctx.svc.create(
    { assetId: ctx.assetId, title: "E7.1c reorder B", priority: "medium" },
    actor,
    [ctx.assetId],
  );

  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.reorder(
    {
      items: [
        { id: a.id, status: "in_progress", sortOrder: 1 },
        { id: b.id, status: "in_progress", sortOrder: 2 },
      ],
    },
    actor,
    [ctx.assetId],
  );
  expect(
    tenant.transactions(),
    "reorder writes then reads back all ids in one shared tenant transaction",
  ).toBe(2);
  expect(
    fleet.transactions(),
    "reorder resolves org/actor via fleet.select, opening no fleet transaction",
  ).toBe(0);
}
