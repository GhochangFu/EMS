import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { OnboardingCommitService } from "./onboarding-commit.service";

/**
 * `E7.1b` — the org-stamping proof for the onboarding commit path.
 *
 * `OnboardingCommitService.commit` writes an entire estate in one transaction:
 * a location, point keys, RTUs, RTU connection configs, assets and asset
 * points. The transaction has run inside `withTenant(tenantDb, org, …)` since
 * F4.16, but only `locations` and `point_keys` carried an `organization_id`
 * then. E7.1b gave `rtus`, `assets` and `asset_points` that column (migration
 * `0046`) and a `tenant_isolation` policy + `FORCE` (`0047`), so their inserts
 * here must now stamp it — otherwise the `WITH CHECK` rejects them once the
 * policy lands. This asserts that stamp under a real `bms_tenant` connection,
 * the only proof the owner connection cannot fake.
 *
 * The commit is done through the wizard's own service, so it is also the one
 * place where `rtu_connection_configs` (the encrypted-credential row, ADR 0012)
 * is written as part of a tenant-scoped commit — isolated by `rtu_id → rtus`,
 * so it carries no `organization_id` of its own.
 */
export type CommitRlsFixtures = {
  commitSvc: OnboardingCommitService;
  ownerPool: pg.Pool;
  organizationId: string;
  /** A seeded, commit-ready draft session in that org. */
  sessionId: string;
};

/** The ids `commit` returns, captured so the lifecycle file can clean them up. */
export type CommitIds = {
  locationId: string;
  rtuIds: string[];
  assetIds: string[];
  pointKeyIds: string[];
  assetPointIds: string[];
};

/**
 * Every row in `table` (a literal from this file, never external input) with an
 * id in `ids` carries `organization_id = org`, and every id resolved to a row.
 */
async function assertAllStamped(
  ownerPool: pg.Pool,
  table: string,
  ids: string[],
  organizationId: string,
): Promise<void> {
  if (ids.length === 0) {
    throw new Error(`E7.1b: expected at least one ${table} row, commit wrote none`);
  }
  const { rows } = await ownerPool.query<{ organization_id: string | null }>(
    `SELECT organization_id FROM bms.${table} WHERE id = ANY($1)`,
    [ids],
  );
  expect(rows.length, `${table}: every id resolves to a row`).toBe(ids.length);
  for (const row of rows) {
    expect(row.organization_id, `${table} row carries the session org`).toBe(organizationId);
  }
}

/**
 * `commit` stamps the session's org on every tenant-bearing row it writes — the
 * three columns E7.1b adds (`rtus`, `assets`, `asset_points`) and, as a
 * regression guard, the two F4.16 already stamped (`locations`, `point_keys`).
 */
export async function assertCommitStampsOrgOnEveryTenantRow(
  ctx: CommitRlsFixtures,
  jwt: JwtPayload,
): Promise<CommitIds> {
  const { commitSvc, ownerPool, organizationId, sessionId } = ctx;

  const result = await commitSvc.commit(jwt, sessionId);
  expect(result.sessionId).toBe(sessionId);
  expect(result.rtuIds.length).toBe(1);
  expect(result.assetIds.length).toBe(1);
  expect(result.assetPointIds.length).toBe(1);

  // The three E7.1b columns, stamped under a real bms_tenant connection.
  await assertAllStamped(ownerPool, "rtus", result.rtuIds, organizationId);
  await assertAllStamped(ownerPool, "assets", result.assetIds, organizationId);
  await assertAllStamped(ownerPool, "asset_points", result.assetPointIds, organizationId);
  // The two F4.16 already stamped — this guards against a regression that would
  // drop them when the E7.1b stamps were added alongside.
  await assertAllStamped(ownerPool, "locations", [result.locationId], organizationId);
  await assertAllStamped(ownerPool, "point_keys", result.pointKeyIds, organizationId);

  return {
    locationId: result.locationId,
    rtuIds: result.rtuIds,
    assetIds: result.assetIds,
    pointKeyIds: result.pointKeyIds,
    assetPointIds: result.assetPointIds,
  };
}
