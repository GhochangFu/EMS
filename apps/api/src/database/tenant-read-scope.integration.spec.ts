import { expect } from "vitest";

import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import { withReadScope } from "./tenant-read-scope";
import type { BmsTx } from "./tenant-context";

/**
 * `E7.1b` (ADR 0043 decisions 1+3) — `withReadScope` is a pure routing function
 * over `(tenantDb, fleetDb, assetIds)`. These assertions drive it with real
 * `bms_tenant`/`bms_fleet` pools and a probe callback that reports **which role
 * ran the read and under which organization GUC** — so the ADR's branch table is
 * asserted verbatim, without instrumenting any production service.
 *
 * The probe reads `current_user` (the connected role) and
 * `current_setting('app.current_organization', true)` (the tenant GUC, empty
 * when unset). A single-organization actor MUST land on `bms_tenant` with the
 * GUC set (decision 1, RLS backstop); an admin or multi-organization actor MUST
 * land on `bms_fleet` with no GUC (decisions 2/3).
 */

export type ReadScopeFixtures = {
  tenantDb: BmsDb;
  fleetDb: BmsDb;
  orgAId: string;
  assetAId: string;
  assetBId: string;
};

type Probe = { usr: string; org: string };

async function probe(tx: BmsTx): Promise<Probe> {
  const res = await tx.execute(
    sql`select current_user as usr, current_setting('app.current_organization', true) as org`,
  );
  const row = res.rows[0] as { usr: string; org: string | null };
  return { usr: row.usr, org: row.org ?? "" };
}

const NEVER: Probe = { usr: "__onEmpty__", org: "__onEmpty__" };

/**
 * Decision 1: exactly one organization resolves to `bms_tenant` with that org's
 * GUC set — the read is scoped by the `0047` FORCE policy, not by a WHERE alone.
 */
export async function assertSingleOrgRunsOnTenantWithGuc(fx: ReadScopeFixtures): Promise<void> {
  const result = await withReadScope(
    fx.tenantDb,
    fx.fleetDb,
    [fx.assetAId],
    () => NEVER,
    probe,
  );
  expect(result.usr).toBe("bms_tenant");
  expect(result.org).toBe(fx.orgAId);
}

/**
 * Decision 3: a two-organization actor "falls back to `fleetDb` at run time" —
 * `bms_fleet`, no GUC. The per-org loop was rejected, so there is exactly one
 * read and it is on fleet.
 */
export async function assertTwoOrgRunsOnFleet(fx: ReadScopeFixtures): Promise<void> {
  const result = await withReadScope(
    fx.tenantDb,
    fx.fleetDb,
    [fx.assetAId, fx.assetBId],
    () => NEVER,
    probe,
  );
  expect(result.usr).toBe("bms_fleet");
  expect(result.org).toBe("");
}

/** Decision 2: the admin sentinel (`assetIds === null`) resolves to fleet. */
export async function assertAdminRunsOnFleet(fx: ReadScopeFixtures): Promise<void> {
  const result = await withReadScope(fx.tenantDb, fx.fleetDb, null, () => NEVER, probe);
  expect(result.usr).toBe("bms_fleet");
  expect(result.org).toBe("");
}

/** No readable assets (`[]`) short-circuits to `onEmpty` — `fn` never runs. */
export async function assertEmptyShortCircuitsWithoutQuery(fx: ReadScopeFixtures): Promise<void> {
  let ran = false;
  const result = await withReadScope(
    fx.tenantDb,
    fx.fleetDb,
    [],
    () => "EMPTY" as const,
    async (tx) => {
      ran = true;
      return (await probe(tx)).usr as unknown as "EMPTY";
    },
  );
  expect(result).toBe("EMPTY");
  expect(ran).toBe(false);
}

/**
 * Asset ids that resolve to no row (vanished or outside the fleet) short-circuit
 * to `onEmpty` too — the DISTINCT-org query returns zero rows.
 */
export async function assertUnknownAssetsShortCircuit(fx: ReadScopeFixtures): Promise<void> {
  let ran = false;
  const result = await withReadScope(
    fx.tenantDb,
    fx.fleetDb,
    ["00000000-0000-4000-8000-0000000000ff"],
    () => "EMPTY" as const,
    async (tx) => {
      ran = true;
      return (await probe(tx)).usr as unknown as "EMPTY";
    },
  );
  expect(result).toBe("EMPTY");
  expect(ran).toBe(false);
}
