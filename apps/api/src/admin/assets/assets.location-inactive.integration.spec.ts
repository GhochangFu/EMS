import type pg from "pg";
import { expect } from "vitest";

import type { AdminAssetDto } from "@bms/shared";

import {
  expectLocationInactive,
  thrown,
  type InactiveFixture,
} from "../../testing/location-inactive-fixture";
import type { AssetsAdminService } from "./assets.service";

/**
 * `F2.10` Unit E — an asset may not be placed on an inactive location (ADR
 * 0098 ruling 15, Amendment 1 A4 and A5): `create`, `reactivate` and the
 * `update` that changes `locationId` answer 409 `location_inactive`; a rename
 * of an asset that already sits on an inactive node is still allowed.
 * Assertions live here (§4.6); `assets.location-inactive.integration.test.ts`
 * owns the pools and the per-run organization.
 */

export type AssetCtx = {
  readonly svc: AssetsAdminService;
  readonly superPool: pg.Pool;
  readonly fx: InactiveFixture;
};

function fail(message: string): never {
  throw new Error(message);
}

function createBody(fx: InactiveFixture, tag: string, locationId: string) {
  const code = `F210E-A-${fx.run}-${tag}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  return { code, name: `F2.10 E ${tag}`, siteName: "F2.10 E site", locationId, domain: fx.domain };
}

async function assetRow(
  db: pg.Pool,
  id: string,
): Promise<{ active: boolean; location_id: string; name: string }> {
  const { rows } = await db.query<{ active: boolean; location_id: string; name: string }>(
    "SELECT active, location_id, name FROM bms.assets WHERE id = $1",
    [id],
  );
  return rows[0] ?? fail(`asset ${id} is gone`);
}

async function auditCount(db: pg.Pool, organizationId: string, action: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.audit_log WHERE organization_id = $1 AND action = $2",
    [organizationId, action],
  );
  return rows[0]?.n ?? 0;
}

/** E-T2a — `create` on an inactive location is 409, writes no asset and no audit row; on an active one it succeeds. */
export async function assertCreateOnAnInactiveLocationIsRefused({ svc, superPool, fx }: AssetCtx): Promise<void> {
  const inactive = await fx.node("T2a-inactive", { active: false });
  const before = await auditCount(superPool, fx.organizationId, "master.asset.create");
  const refused = createBody(fx, "T2a-refused", inactive);
  expectLocationInactive(await thrown(() => svc.create(fx.orgAdmin, refused)));
  const { rows } = await superPool.query("SELECT 1 FROM bms.assets WHERE code = $1", [refused.code]);
  expect(rows).toHaveLength(0);
  expect(await auditCount(superPool, fx.organizationId, "master.asset.create")).toBe(before);

  const active = await fx.node("T2a-active");
  const created = await svc.create(fx.orgAdmin, createBody(fx, "T2a-ok", active));
  expect(created.active).toBe(true);
  expect(created.locationId).toBe(active);
  expect(await auditCount(superPool, fx.organizationId, "master.asset.create")).toBe(before + 1);
}

/** E-T2b — `reactivate` of an asset whose location is inactive is 409 and leaves it inactive; on an active location it succeeds. */
export async function assertReactivateOnAnInactiveLocationIsRefused({ svc, superPool, fx }: AssetCtx): Promise<void> {
  const node = await fx.node("T2b-retired");
  const asset = await fx.asset("T2b-refused", node, { active: false });
  await fx.setLocationActive(node, false);
  expectLocationInactive(await thrown(() => svc.reactivate(fx.orgAdmin, asset)));
  expect((await assetRow(superPool, asset)).active).toBe(false);

  const live = await fx.node("T2b-live");
  const restorable = await fx.asset("T2b-ok", live, { active: false });
  const restored = await svc.reactivate(fx.orgAdmin, restorable);
  expect(restored.active).toBe(true);
}

/** E-T2c — the `update` that moves an asset to an inactive location is 409 and changes nothing; a move to an active one succeeds. */
export async function assertMoveToAnInactiveLocationIsRefused({ svc, superPool, fx }: AssetCtx): Promise<void> {
  const home = await fx.node("T2c-home");
  const inactive = await fx.node("T2c-inactive", { active: false });
  const asset = await fx.asset("T2c", home);
  expectLocationInactive(
    await thrown(() => svc.update(fx.orgAdmin, asset, { locationId: inactive, name: "F2.10 E moved" })),
  );
  const unchanged = await assetRow(superPool, asset);
  expect(unchanged.location_id).toBe(home);
  expect(unchanged.name).toBe("F2.10 E asset T2c");

  const away = await fx.node("T2c-away");
  const moved: AdminAssetDto = await svc.update(fx.orgAdmin, asset, { locationId: away });
  expect(moved.locationId).toBe(away);
}

/**
 * E-T2d — A4: a rename of an asset that already sits on an inactive node is
 * allowed, with or without the unchanged `locationId` in the body (the asset
 * form always sends it).
 */
export async function assertRenameOnAnInactiveLocationIsAllowed({ svc, superPool, fx }: AssetCtx): Promise<void> {
  const node = await fx.node("T2d");
  const asset = await fx.asset("T2d", node);
  await fx.setLocationActive(node, false);

  const renamed = await svc.update(fx.orgAdmin, asset, { name: "F2.10 E renamed" });
  expect(renamed.name).toBe("F2.10 E renamed");
  const resent = await svc.update(fx.orgAdmin, asset, { name: "F2.10 E renamed again", locationId: node });
  expect(resent.name).toBe("F2.10 E renamed again");
  expect((await assetRow(superPool, asset)).location_id).toBe(node);
}

type Settled<T> = { ok: T } | { err: unknown };

/**
 * E-T4 — A5 for the asset create. A superuser holds the location row
 * `FOR UPDATE`; `create` must wait on it (its `FOR SHARE` read conflicts);
 * the superuser deactivates the location and commits; the create then reads
 * the committed `active = false` and refuses. Without `FOR SHARE` the plain
 * read does not wait and sees `active = true`; the asset INSERT's foreign-key
 * check (`FOR KEY SHARE`) then waits on the holder and lands after the commit.
 * The gate is the outcome — a create that succeeded is red — not the poll.
 */
export async function assertCreateWaitsForAConcurrentDeactivation({ svc, superPool, fx }: AssetCtx): Promise<void> {
  const L = await fx.node("T4-L");
  const body = createBody(fx, "T4", L);
  const client = await superPool.connect();
  let settled: Promise<Settled<AdminAssetDto>> | undefined;
  try {
    await client.query("BEGIN");
    const { rows: me } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const holder = me[0]?.pid ?? fail("no backend pid");
    await client.query("SELECT 1 FROM bms.locations WHERE id = $1 FOR UPDATE", [L]);
    settled = svc.create(fx.orgAdmin, body).then(
      (ok) => ({ ok }),
      (err: unknown) => ({ err }),
    );

    const deadline = Date.now() + 5_000;
    let waiting = false;
    while (!waiting && Date.now() < deadline) {
      const { rows } = await superPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND pg_blocking_pids(pid) @> ARRAY[$1::int]`,
        [holder],
      );
      waiting = (rows[0]?.n ?? 0) > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting, "the create never waited on the location row").toBe(true);

    await client.query("UPDATE bms.locations SET active = false WHERE id = $1", [L]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const outcome = await (settled ?? fail("the create was never started"));
  if ("ok" in outcome) {
    fail(`the create succeeded on a location deactivated under it (asset ${outcome.ok.id})`);
  }
  expectLocationInactive(outcome.err);
  const { rows } = await superPool.query("SELECT 1 FROM bms.assets WHERE code = $1", [body.code]);
  expect(rows).toHaveLength(0);
}
