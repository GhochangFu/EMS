import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { adminAssetDomainsListResponseSchema, WORK_ORDER_PREFIX_PATTERN } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { WorkOrdersService } from "../../work-orders/work-orders.service";
import { ASSET_DOMAIN_ADMIN_DENIAL, type AssetDomainsAdminService } from "./asset-domains.service";

/**
 * `E3.1` (ADR 0122 decision 2.4, rulings P8 and R4; plan T7.1) — the domain prefix
 * route's service against real pool roles. Assertions live here;
 * `asset-domains.service.integration.test.ts` owns the database lifecycle (ADR 0014).
 *
 * Every write is on a domain row this run made (`ownDomain`), so no seeded prefix — which
 * other suites read — moves under a parallel run.
 */
export type AssetDomainFixtures = {
  svc: AssetDomainsAdminService;
  workOrders: WorkOrdersService;
  fleetPool: pg.Pool;
  globalAdmin: JwtPayload;
  organizationAdmin: JwtPayload;
  locationAdmin: JwtPayload;
  /** A domain code this run inserted, with no prefix. */
  ownDomain: string;
  /** An asset of the organization admin's organization, in `ownDomain`, with no template. */
  assetId: string;
};

async function prefixOf(pool: pg.Pool, code: string): Promise<string | null> {
  const { rows } = await pool.query<{ work_order_prefix: string | null }>("SELECT work_order_prefix FROM bms.asset_domains WHERE code = $1", [code]);
  if (!rows[0]) throw new Error("E3.1: the fixture domain is gone");
  return rows[0].work_order_prefix;
}

async function auditsOf(pool: pg.Pool, code: string): Promise<Array<{ organization_id: string | null; payload: Record<string, unknown> }>> {
  const { rows } = await pool.query<{ organization_id: string | null; payload: Record<string, unknown> }>(
    "SELECT organization_id, payload FROM bms.audit_log WHERE action = 'master.asset_domain.update' AND payload->>'code' = $1 ORDER BY created_at",
    [code],
  );
  return rows;
}

/** Only the global admin reads the list or writes a prefix: each tenant administrator is refused (403), and nothing changes. */
export async function assertOnlyTheGlobalAdminMayReadOrWrite(ctx: AssetDomainFixtures): Promise<void> {
  for (const jwt of [ctx.organizationAdmin, ctx.locationAdmin]) {
    const list = ctx.svc.list(jwt);
    await expect(list, jwt.role).rejects.toBeInstanceOf(ForbiddenException);
    await expect(list, jwt.role).rejects.toThrow(ASSET_DOMAIN_ADMIN_DENIAL);
    const write = ctx.svc.update(jwt, ctx.ownDomain, { workOrderPrefix: "NOPE" });
    await expect(write, jwt.role).rejects.toBeInstanceOf(ForbiddenException);
    await expect(write, jwt.role).rejects.toThrow(ASSET_DOMAIN_ADMIN_DENIAL);
  }
  expect(await prefixOf(ctx.fleetPool, ctx.ownDomain), "no refused write landed").toBeNull();
  expect(await auditsOf(ctx.fleetPool, ctx.ownDomain), "and none was audited").toEqual([]);
}

/** The list answers every domain with its prefix, in the contract's shape, the run's own included. */
export async function assertTheListAnswersEveryDomain(ctx: AssetDomainFixtures): Promise<void> {
  const list = await ctx.svc.list(ctx.globalAdmin);
  expect(adminAssetDomainsListResponseSchema.safeParse(list).success, "the list matches its contract").toBe(true);
  const byCode = new Map(list.items.map((item) => [item.code, item]));
  expect(byCode.get(ctx.ownDomain)).toEqual({ code: ctx.ownDomain, label: "E3.1 fixture domain", sortOrder: 9000, active: true, workOrderPrefix: null });
  // The seeded domains are listed too. Their prefixes are whatever this database holds —
  // this very screen lets an administrator change them — so only their shape is asserted.
  for (const code of ["electrical", "water"]) {
    const seeded = byCode.get(code);
    expect(seeded, `${code} is listed`).toBeDefined();
    expect(seeded?.workOrderPrefix === null || WORK_ORDER_PREFIX_PATTERN.test(seeded?.workOrderPrefix ?? ""), code).toBe(true);
  }
}

/** An unknown code answers 404 and writes no audit row. */
export async function assertAnUnknownCodeIsNotFound(ctx: AssetDomainFixtures): Promise<void> {
  await expect(ctx.svc.update(ctx.globalAdmin, "e31d_no_such_domain", { workOrderPrefix: "NOPE" })).rejects.toBeInstanceOf(NotFoundException);
  expect(await auditsOf(ctx.fleetPool, "e31d_no_such_domain")).toEqual([]);
}

/**
 * The write sets the prefix and audits the old and the new value, org-less. A ticket made
 * afterwards takes the new prefix; a ticket made before keeps its reference. Clearing the
 * prefix sends later tickets back to `GEN`.
 */
export async function assertAPrefixChangeReachesLaterTicketsOnly(ctx: AssetDomainFixtures): Promise<void> {
  const actor = ctx.organizationAdmin;
  const before = await ctx.workOrders.create({ assetId: ctx.assetId, title: "E3.1 domain prefix: before", priority: "low" }, actor, null);
  expect(before.reference.startsWith("GEN-"), "no prefix yet").toBe(true);

  const updated = await ctx.svc.update(ctx.globalAdmin, ctx.ownDomain, { workOrderPrefix: "E31D" });
  expect(updated).toEqual({ code: ctx.ownDomain, label: "E3.1 fixture domain", sortOrder: 9000, active: true, workOrderPrefix: "E31D" });
  expect(await prefixOf(ctx.fleetPool, ctx.ownDomain)).toBe("E31D");

  const after = await ctx.workOrders.create({ assetId: ctx.assetId, title: "E3.1 domain prefix: after", priority: "low" }, actor, null);
  expect(after.reference.startsWith("E31D-"), after.reference).toBe(true);
  const { items } = await ctx.workOrders.list({ limit: 100, assetIds: [ctx.assetId] });
  expect(items.find((item) => item.id === before.id)?.reference, "the older ticket keeps its reference").toBe(before.reference);

  const cleared = await ctx.svc.update(ctx.globalAdmin, ctx.ownDomain, { workOrderPrefix: null });
  expect(cleared.workOrderPrefix).toBeNull();
  const fallback = await ctx.workOrders.create({ assetId: ctx.assetId, title: "E3.1 domain prefix: cleared", priority: "low" }, actor, null);
  expect(fallback.reference.startsWith("GEN-"), fallback.reference).toBe(true);

  const audits = await auditsOf(ctx.fleetPool, ctx.ownDomain);
  expect(audits.map((row) => [row.organization_id, row.payload.fromWorkOrderPrefix, row.payload.toWorkOrderPrefix])).toEqual([
    [null, null, "E31D"],
    [null, "E31D", null],
  ]);
}

/** The column's own CHECK refuses a prefix the body schema would have let through, so no other writer can store one. */
export async function assertTheColumnCheckHoldsThePattern(ctx: AssetDomainFixtures): Promise<void> {
  await expect(
    ctx.fleetPool.query("UPDATE bms.asset_domains SET work_order_prefix = 'lower' WHERE code = $1", [ctx.ownDomain]),
  ).rejects.toMatchObject({ code: "23514" });
}
