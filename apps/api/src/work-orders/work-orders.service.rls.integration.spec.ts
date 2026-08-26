import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { WorkOrdersService } from "./work-orders.service";

/**
 * `E7.1b` — the org-stamping and actor-resolution proof for the work-orders
 * write path against real, non-owner roles.
 *
 * `work_orders` gained an `organization_id` column (migration `0046`, org =
 * `asset_id → assets.org`) and a `tenant_isolation` policy + `FORCE` in `0047`.
 * The three writers — `create`, `updateStatus`, `reorder` — now run inside
 * `withTenant`, and `create` stamps the column. Constructing the service with a
 * real `bms_tenant`/`bms_fleet` pair is the only proof the stamp and the actor
 * resolution work under the roles the deployment uses; the owner connection
 * bypasses row-level security and would pass regardless.
 *
 * The actor assertion is load-bearing: `resolveActorId` reads `bms.users`, which
 * after `0047` is invisible to the bare tenant pool for a scoped user. Reading
 * it on `fleetDb` is what keeps `created_by` populated — a NULL there is exactly
 * the silent actor-loss the plan's Task-4 finding describes.
 */
export type WorkOrdersRlsFixtures = {
  svc: WorkOrdersService;
  ownerPool: pg.Pool;
  organizationId: string;
  /** A hand-created asset in that org, the work order's parent. */
  assetId: string;
  /** The acting user's row id — `created_by`/`actor_id` must resolve to it. */
  actorUserId: string;
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
