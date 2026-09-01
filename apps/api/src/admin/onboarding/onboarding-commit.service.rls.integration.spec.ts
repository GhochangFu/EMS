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
  // The one F4.16 table still stamped — this guards against a regression that
  // would drop it when the E7.1b stamps were added alongside.
  await assertAllStamped(ownerPool, "locations", [result.locationId], organizationId);

  // **`F3.39` — `point_keys` left this list, and its assertion is inverted
  // rather than deleted.** Migration `0057` drops the column, so a commit
  // cannot stamp an organization on a catalog row and the old assertion tested
  // a mechanism that no longer exists. What is worth holding instead is that
  // the commit still CREATES the codes it declares: the FK `0057` adds means an
  // asset_points row cannot exist without one, so a commit that silently
  // stopped writing them would fail loudly here rather than three tables later.
  expect(result.pointKeyIds.length, "the commit created its declared point key").toBe(1);
  const { rows: keyRows } = await ownerPool.query<{ id: string }>(
    `SELECT id FROM bms.point_keys WHERE id = ANY($1)`,
    [result.pointKeyIds],
  );
  expect(
    keyRows.length,
    "every point key the commit reported must exist, readable with no tenant context — " +
      "bms.point_keys carries no policy after 0057",
  ).toBe(result.pointKeyIds.length);

  return {
    locationId: result.locationId,
    rtuIds: result.rtuIds,
    assetIds: result.assetIds,
    pointKeyIds: result.pointKeyIds,
    assetPointIds: result.assetPointIds,
  };
}

/** What the ADR 0051 Amendment 1 refusal needs, beyond the commit itself. */
export type CommitConflictFixtures = {
  commitSvc: OnboardingCommitService;
  ownerPool: pg.Pool;
  /** A commit-ready draft that redeclares `pointKeyCode` with a new unit. */
  sessionId: string;
  /** A catalog code that exists already, registered with no unit. */
  pointKeyCode: string;
  /** The location code that draft would write, if it got that far. */
  locationCode: string;
};

/**
 * ADR 0051 Amendment 1 decisions 2 and 3 — the wiring assertion.
 *
 * The rule itself is proved by `onboarding-point-key-conflict.spec.ts`, which
 * needs no database and therefore runs on every machine. What only a real
 * commit can show is the three things around it: that the service consults the
 * catalog row rather than just its id, that the refusal is a `400` and not a
 * constraint error, and that the transaction rolls back — the location the
 * commit inserts two statements earlier must not survive the throw.
 */
export async function assertCommitRefusesAContradictingPointKey(
  ctx: CommitConflictFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { commitSvc, ownerPool, sessionId, pointKeyCode, locationCode } = ctx;

  await expect(
    commitSvc.commit(jwt, sessionId),
    "a draft declaring a unit the catalog leaves unset is refused",
  ).rejects.toThrow(/already exists in the fleet-wide catalog/);

  const { rows: keyRows } = await ownerPool.query<{ unit: string | null }>(
    `SELECT unit FROM bms.point_keys WHERE code = $1`,
    [pointKeyCode],
  );
  expect(keyRows.length, "the catalog row is still there").toBe(1);
  expect(
    keyRows[0].unit,
    "the refused draft did not fill the unit every organization shares",
  ).toBeNull();

  const { rows: locationRows } = await ownerPool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE code = $1`,
    [locationCode],
  );
  expect(
    locationRows.length,
    "the location inserted before the point-key loop rolled back with it",
  ).toBe(0);
}
