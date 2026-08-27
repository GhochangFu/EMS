import { inArray } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { withTenant, type BmsTx } from "./tenant-context";

/**
 * `E7.1b` / ADR 0043 decisions 1+3 — routes a **user-facing decision-1 LIST
 * read** to the pool the amendment mandates, from the caller's readable
 * `assetIds` alone.
 *
 * Decision 1: a decision-1 tenant-data read (alarms, rule executions, work
 * orders, maintenance rows, automation rules) runs **inside `withTenant` by
 * default**, so a single-organization actor is scoped by the `0047` `FORCE` RLS
 * policy — not by a `WHERE` filter alone. Decision 2: a genuinely fleet-wide
 * `admin` view resolves across organizations on `fleetDb`. Decision 3: a
 * multi-organization actor "falls back to `fleetDb` at run time" (the per-org
 * loop was considered and rejected — a keyset cursor cannot survive it).
 *
 * The organization is derived from `assets.organization_id` on `fleetDb`. That
 * is a master-data resolution, pre-tenant, the same "bypass, then trust an
 * already-computed grant" shape `AccessControlService` uses throughout — and
 * `assets.organization_id` is `NOT NULL` since `0047`, so a resolved org is
 * never null.
 */
export type ReadScopeResolution =
  | { kind: "empty" }
  | { kind: "single"; organizationId: string }
  | { kind: "fleet" };

/**
 * Classifies a read from its `assetIds`. `null`/`undefined` is the unrestricted
 * admin sentinel (`readableAssetIds` returns `null` for a global admin).
 */
export async function resolveTenantReadScope(
  fleetDb: BmsDb,
  assetIds: string[] | null | undefined,
): Promise<ReadScopeResolution> {
  if (assetIds === null || assetIds === undefined) {
    return { kind: "fleet" }; // admin: a decision-2 fleet-wide view
  }
  if (assetIds.length === 0) {
    return { kind: "empty" };
  }
  const rows = await fleetDb
    .select({ organizationId: assets.organizationId })
    .from(assets)
    .where(inArray(assets.id, assetIds))
    .groupBy(assets.organizationId);
  if (rows.length === 0) {
    return { kind: "empty" }; // the ids resolve to no asset (vanished/foreign)
  }
  if (rows.length === 1) {
    return { kind: "single", organizationId: rows[0].organizationId };
  }
  return { kind: "fleet" }; // multi-org: decision 3 run-time fallback
}

/**
 * The single seam every conformed decision-1 LIST read runs through. `fn` always
 * receives a `BmsTx`:
 *
 * - single organization → `withTenant(tenantDb, org, fn)` — the GUC is set and
 *   the `0047` policy scopes the read (decision 1, the RLS backstop);
 * - admin or multi-organization → `fleetDb.transaction(fn)` — `bms_fleet` is
 *   `BYPASSRLS`, so no GUC (decisions 2/3), and the caller's `assetIds` `WHERE`
 *   filter is the isolation control the amendment trusts there;
 * - no readable assets → `onEmpty()`, and `fn` never runs (no query).
 *
 * Every downstream read inside `fn` MUST use the passed `tx`. A stray
 * `this.fleetDb` inside a tenant transaction compiles, runs on a second
 * connection with no GUC, and silently unscopes that read.
 */
export async function withReadScope<T>(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  assetIds: string[] | null | undefined,
  onEmpty: () => T,
  fn: (tx: BmsTx) => Promise<T>,
): Promise<T> {
  const scope = await resolveTenantReadScope(fleetDb, assetIds);
  if (scope.kind === "empty") {
    return onEmpty();
  }
  if (scope.kind === "single") {
    return withTenant(tenantDb, scope.organizationId, fn);
  }
  return fleetDb.transaction(fn);
}
