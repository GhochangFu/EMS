import type pg from "pg";
import { expect } from "vitest";

import {
  expectLocationInactive,
  thrown,
  type InactiveFixture,
} from "../../testing/location-inactive-fixture";
import type { RtusAdminService } from "./rtus.service";

/**
 * `F2.10` Unit E — an RTU may not be placed on an inactive location (ADR 0098
 * ruling 15, Amendment 1 A4 and A5): `create` and `reactivate` answer 409
 * `location_inactive`; a rename of an RTU that already sits on an inactive
 * node is still allowed. The RTU update cannot move an RTU (`locationId` is
 * not in its schema — `rtus.schema.spec.ts` pins that), so A4's move arm is
 * N/A here. Assertions live here (§4.6);
 * `rtus.location-inactive.integration.test.ts` owns the pools.
 */

export type RtuCtx = {
  readonly svc: RtusAdminService;
  readonly superPool: pg.Pool;
  readonly fx: InactiveFixture;
};

function fail(message: string): never {
  throw new Error(message);
}

function createBody(fx: InactiveFixture, tag: string, locationId: string) {
  const code = `F210E-R-${fx.run}-${tag}-${Math.random().toString(36).slice(2, 8)}`;
  return { locationId, code, displayName: `F2.10 E ${tag}`, sourceType: "catalog" as const };
}

async function rtuRow(db: pg.Pool, id: string): Promise<{ active: boolean; display_name: string }> {
  const { rows } = await db.query<{ active: boolean; display_name: string }>(
    "SELECT active, display_name FROM bms.rtus WHERE id = $1",
    [id],
  );
  return rows[0] ?? fail(`RTU ${id} is gone`);
}

async function auditCount(db: pg.Pool, organizationId: string, action: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.audit_log WHERE organization_id = $1 AND action = $2",
    [organizationId, action],
  );
  return rows[0]?.n ?? 0;
}

/** E-T3a — `create` on an inactive location is 409, writes no RTU and no audit row; on an active one it succeeds. */
export async function assertCreateOnAnInactiveLocationIsRefused({ svc, superPool, fx }: RtuCtx): Promise<void> {
  const inactive = await fx.node("T3a-inactive", { active: false });
  const before = await auditCount(superPool, fx.organizationId, "master.rtu.create");
  const refused = createBody(fx, "T3a-refused", inactive);
  expectLocationInactive(await thrown(() => svc.create(fx.orgAdmin, refused)));
  const { rows } = await superPool.query("SELECT 1 FROM bms.rtus WHERE code = $1", [refused.code]);
  expect(rows).toHaveLength(0);
  expect(await auditCount(superPool, fx.organizationId, "master.rtu.create")).toBe(before);

  const active = await fx.node("T3a-active");
  const created = await svc.create(fx.orgAdmin, createBody(fx, "T3a-ok", active));
  expect(created.active).toBe(true);
  expect(created.locationId).toBe(active);
}

/** E-T3b — `reactivate` of an RTU whose location is inactive is 409 and leaves it inactive; on an active location it succeeds. */
export async function assertReactivateOnAnInactiveLocationIsRefused({ svc, superPool, fx }: RtuCtx): Promise<void> {
  const node = await fx.node("T3b-retired");
  const rtu = await fx.rtu("T3b-refused", node, { active: false });
  await fx.setLocationActive(node, false);
  expectLocationInactive(await thrown(() => svc.reactivate(fx.orgAdmin, rtu)));
  expect((await rtuRow(superPool, rtu)).active).toBe(false);

  const live = await fx.node("T3b-live");
  const restorable = await fx.rtu("T3b-ok", live, { active: false });
  const restored = await svc.reactivate(fx.orgAdmin, restorable);
  expect(restored.active).toBe(true);
}

/** E-T3c — A4: a rename of an RTU that already sits on an inactive node is allowed. */
export async function assertRenameOnAnInactiveLocationIsAllowed({ svc, superPool, fx }: RtuCtx): Promise<void> {
  const node = await fx.node("T3c");
  const rtu = await fx.rtu("T3c", node);
  await fx.setLocationActive(node, false);
  const renamed = await svc.update(fx.orgAdmin, rtu, { displayName: "F2.10 E renamed RTU" });
  expect(renamed.displayName).toBe("F2.10 E renamed RTU");
  expect((await rtuRow(superPool, rtu)).display_name).toBe("F2.10 E renamed RTU");
}
