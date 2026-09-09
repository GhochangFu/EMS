import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import { COMMIT_UNIQUE_CONFLICTS } from "./onboarding-commit-conflict";
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

/** What the `F4.109` duplicate-value refusal needs. */
export type CommitDuplicateFixtures = {
  commitSvc: OnboardingCommitService;
  ownerPool: pg.Pool;
  /** A commit-ready draft whose `location.code` a seeded row already holds. */
  sessionId: string;
  organizationId: string;
  /** The code carried by both the seeded row and the draft. */
  locationCode: string;
};

/**
 * `F4.109` — a duplicate value is a per-field `400`, measured through a real
 * transaction rather than a stubbed one.
 *
 * `onboarding-commit-conflict.spec.ts` proves the map, the narrowing and the
 * wiring with a hand-built driver error. **What only a real database can show
 * is the link that spec fakes**: that Postgres raises `23505` naming
 * `locations_org_code_idx` for this insert, that drizzle rolls the transaction
 * back and re-throws the driver's own error object rather than wrapping it, and
 * that `code` and `constraint` are therefore still readable by the time
 * `translateCommitUniqueConflict` sees it. Every one of those three could break
 * without a unit test noticing.
 *
 * The seeded row is written by the fixture, not by a sibling test, so this case
 * does not depend on the order the file's `it()`s run in.
 *
 * **This case shipped with four `expect`s and now has two, because review and
 * then a live probe showed the other two could not fail.** `expect` throws, so
 * only the first failure runs, and both dead ones sat below a body equality
 * against a static literal.
 *
 * - `getStatus() === 400` cannot fail at any position. `BadRequestException` is
 *   400 by construction, and the equality above has already established the
 *   type.
 * - `!body.includes(locationCode)` — an echo check — was dead by construction
 *   too: the body is compared to `conflict.message`, a fixed string, while
 *   `locationCode` carries a per-run suffix, so any edit that could put the
 *   value in the body changes the body and the equality reddens first.
 *   Reordering it was the obvious repair and it **still** did not fire under the
 *   mutation that appends `err.detail` to the message. The reason is worth
 *   keeping: Postgres's `BuildIndexValueDescription` returns NULL when RLS is
 *   enabled on the relation, so on `bms.locations` the value never reaches the
 *   driver at all. Probed as `bms_owner`, `err.detail` is `undefined`; as
 *   `bms_fleet` (`BYPASSRLS`) the same insert yields the full key. There is no
 *   value here to echo, so no assertion here can hold the §4.3 rule.
 *
 * What is left is stronger than either, and it is worth being exact about how
 * far. Equality to a fixed body forbids every **addition** — `detail`,
 * `constraint`, `table`, `schema`, the driver's message — and every substituted
 * **message**. It reddens under the load-bearing mutation, removing the `.catch`
 * from `commit`, which leaves a raw driver error here; measured, the failure
 * reads `expected 'not a BadRequestException: error: dup…'`.
 *
 * It does **not** hold a substituted *field*. A translation that ignored the
 * entry it looked up and hard-coded `location` would leave this case green,
 * because `location` is the field under test. That mutation belongs to
 * `assertEveryMappedConstraintBecomesItsOwnFieldError` in the unit spec, which
 * walks all nine. The §4.3 sentinels live there too, where a synthetic error can
 * carry the `detail` this path withholds.
 */
export async function assertCommitAnswersADuplicateLocationCodeWithAFieldError(
  ctx: CommitDuplicateFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { commitSvc, ownerPool, sessionId, organizationId, locationCode } = ctx;

  const conflict = COMMIT_UNIQUE_CONFLICTS.get("locations_org_code_idx");
  if (!conflict) {
    throw new Error("F4.109: locations_org_code_idx is not in COMMIT_UNIQUE_CONFLICTS");
  }

  let raised: unknown;
  try {
    await commitSvc.commit(jwt, sessionId);
  } catch (error) {
    raised = error;
  }

  // One string from whatever was raised, so a raw driver error is compared as
  // readily as a refusal. A `pg` error's `code`, `constraint`, `table` and
  // `schema` are own enumerable properties, so `JSON.stringify` reaches them and
  // the equality below refuses them all.
  const answered =
    raised instanceof BadRequestException
      ? JSON.stringify(raised.getResponse())
      : `not a BadRequestException: ${String(raised)} ${JSON.stringify(raised)}`;

  expect(
    answered,
    "a duplicate location code is answered as a per-field 400, not a 500",
  ).toBe(JSON.stringify({ formErrors: [], fieldErrors: { location: [conflict.message] } }));

  const { rows } = await ownerPool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE code = $1 AND organization_id = $2`,
    [locationCode, organizationId],
  );
  expect(rows.length, "the refused commit wrote no second location and rolled back").toBe(1);
}
