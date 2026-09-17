import { eq } from "drizzle-orm";
import type pg from "pg";

import { organizations } from "@bms/db";
import type { BmsDb } from "@bms/db";
// `@bms/shared`, not `@bms/shared/contracts`: apps/api compiles with
// moduleResolution "node" and ignores the exports map (ADR 0030 Amendment 2).
import { assetListRowSchema } from "@bms/shared";

import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { AccessControlService } from "../auth/access-control.service";
import { resolveSeededAssetByCode } from "../testing/integration-fixtures";
import { AssetsService } from "./assets.service";

/**
 * Found in review of the `E2.1` affected-asset picker: `GET /api/v1/assets`
 * had no organization filter at all, so a global admin's picker showed every
 * asset across every seeded organization mixed together — confusing, and the
 * wrong candidate list for "assets related to this alarm". Read-only against
 * seed data, so no transaction/rollback is needed — nothing here writes.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function orgIdByCode(db: BmsDb, code: string): Promise<string> {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.code, code))
    .limit(1);
  if (!row) {
    throw new Error(`no seeded organization with code ${code} — run pnpm db:seed first`);
  }
  return row.id;
}

export async function assertListAllScopesByOrganization(db: BmsDb): Promise<void> {
  const eskomId = await orgIdByCode(db, "ESKOM");
  const phewbId = await orgIdByCode(db, "PHEWB");
  const svc = new AssetsService(db);

  const eskomAssets = await svc.listAll(null, eskomId);
  assert(eskomAssets.length > 0, "expected at least one seeded ESKOM asset");

  const phewbAssets = await svc.listAll(null, phewbId);
  assert(phewbAssets.length > 0, "expected at least one seeded PHEWB asset");

  const eskomIds = new Set(eskomAssets.map((a) => a.id));
  const overlap = phewbAssets.filter((a) => eskomIds.has(a.id));
  assert(
    overlap.length === 0,
    `an organizationId filter must not leak assets from another organization, found: ${overlap.map((a) => a.id).join(", ")}`,
  );

  const unfiltered = await svc.listAll(null);
  assert(
    unfiltered.length >= eskomAssets.length + phewbAssets.length,
    "omitting organizationId must still return the full unscoped set — existing callers must not silently narrow",
  );
}

/** The `assetIds` scope and the `organizationId` filter compose (AND, not OR). */
export async function assertListAllComposesAssetIdsAndOrganization(db: BmsDb): Promise<void> {
  const eskomId = await orgIdByCode(db, "ESKOM");
  const phewbId = await orgIdByCode(db, "PHEWB");
  const svc = new AssetsService(db);

  const oneEskomAsset = await svc.listAll(null, eskomId);
  const firstId = oneEskomAsset[0]?.id;
  if (!firstId) {
    throw new Error("expected at least one seeded ESKOM asset");
  }

  const scopedToOneIdWithinEskom = await svc.listAll([firstId], eskomId);
  assert(
    scopedToOneIdWithinEskom.length === 1 && scopedToOneIdWithinEskom[0]?.id === firstId,
    "an assetIds scope containing an in-organization asset must return it",
  );

  const scopedToOneIdWithinPhewb = await svc.listAll([firstId], phewbId);
  assert(
    scopedToOneIdWithinPhewb.length === 0,
    "an ESKOM asset id filtered against the PHEWB organization must return nothing, not the asset anyway",
  );
}

/*
 * `F3.31` (ADR 0068 decision 2) — the three guards the ADR owes on the widened
 * list read. The fixture pair is seeded: `CR-HVAC-1` is wired to an RTU by the
 * seed's backfill; `ESK-MANUAL-01` (`access-fixtures-seed.ts`) has `rtu_id NULL`
 * and a `meta` bag with no `telemetrySource` key — the pre-`F4.139` shape the
 * decision names. Both are resolved by `resolveSeededAssetByCode` (a named,
 * organization-by-organization read), never positionally. The wired row's
 * values are compared to an independent SQL read of the same join, never to a
 * literal: the seed is free to change which RTU or which source a row carries.
 */

/** The six columns the widened row carries, as the independent SQL read names them. */
type ListRowColumns = {
  rtuId: string | null;
  rtuDisplayName: string | null;
  locationName: string;
  active: boolean;
  telemetrySource: string | null;
  templateId: string | null;
};

const LIST_ROW_COLUMNS: readonly (keyof ListRowColumns)[] = [
  "rtuId",
  "rtuDisplayName",
  "locationName",
  "active",
  "telemetrySource",
  "templateId",
];

async function readListRowColumns(pool: pg.Pool, assetId: string): Promise<ListRowColumns> {
  const { rows } = await pool.query<ListRowColumns>(
    `SELECT a.rtu_id AS "rtuId",
            r.display_name AS "rtuDisplayName",
            l.name AS "locationName",
            a.active,
            a.meta->>'telemetrySource' AS "telemetrySource",
            a.template_id AS "templateId"
       FROM bms.assets a
       JOIN bms.locations l ON l.id = a.location_id
       LEFT JOIN bms.rtus r ON r.id = a.rtu_id
      WHERE a.id = $1`,
    [assetId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`no bms.assets row with id ${assetId} — the fleet pool should see every row`);
  }
  return row;
}

async function seededPair(pool: pg.Pool): Promise<{ wiredId: string; manualId: string }> {
  return {
    wiredId: await resolveSeededAssetByCode(pool, "CR-HVAC-1"),
    manualId: await resolveSeededAssetByCode(pool, "ESK-MANUAL-01"),
  };
}

/**
 * G1 — every row parses under `assetListRowSchema` (the positive control: a
 * missing column fails here first), and the wired row's six new values equal
 * an independent read of the same join.
 */
export async function assertListAllReportsWiredRowColumns(
  pool: pg.Pool,
  db: BmsDb,
): Promise<void> {
  const { wiredId, manualId } = await seededPair(pool);
  const rows = await new AssetsService(db).listAll([wiredId, manualId]);
  assert(rows.length === 2, `expected the two seeded fixture rows, got ${rows.length}`);

  for (const row of rows) {
    const parsed = assetListRowSchema.safeParse(row);
    assert(
      parsed.success,
      `GET /assets row ${row.code} must parse under assetListRowSchema: ` +
        JSON.stringify(parsed.success ? null : parsed.error.flatten().fieldErrors),
    );
  }

  const wired = rows.find((row) => row.id === wiredId);
  assert(wired !== undefined, "CR-HVAC-1 must be in the list");
  const expected = await readListRowColumns(pool, wiredId);
  assert(expected.rtuId !== null, "control: the seed wires CR-HVAC-1 to an RTU");
  // Without this, a seed that drops the key makes the loop compare null to
  // null and a mis-typed projection (`->>'telemetry_source'`) goes unseen.
  assert(
    expected.telemetrySource !== null,
    "control: the seed stamps CR-HVAC-1 with a meta.telemetrySource",
  );
  for (const column of LIST_ROW_COLUMNS) {
    assert(
      wired?.[column] === expected[column],
      `wired row ${column}: service reported ${JSON.stringify(wired?.[column])}, ` +
        `SQL reads ${JSON.stringify(expected[column])}`,
    );
  }
}

/**
 * G1b — the unwired, pre-`F4.139` row is PRESENT (a LEFT JOIN on `rtus`, ADR
 * 0018: an asset need not be wired) and reports `null`, not a derived guess,
 * for the RTU columns and the source. The count is asserted first and on this
 * function's own `listAll`, so an INNER JOIN reddens this guard and not G1.
 */
export async function assertListAllKeepsUnwiredRowWithNulls(
  pool: pg.Pool,
  db: BmsDb,
): Promise<void> {
  const { wiredId, manualId } = await seededPair(pool);
  const stored = await readListRowColumns(pool, manualId);
  assert(
    stored.rtuId === null && stored.telemetrySource === null && stored.active,
    "control: the seed leaves ESK-MANUAL-01 unwired, active and without a telemetrySource key",
  );

  const rows = await new AssetsService(db).listAll([wiredId, manualId]);
  assert(
    rows.length === 2,
    `an unwired asset must stay in the list (rtus is LEFT JOINed), got ${rows.length} rows`,
  );
  const manual = rows.find((row) => row.id === manualId);
  assert(manual !== undefined, "ESK-MANUAL-01 must be in the list");
  assert(manual?.rtuId === null, `unwired row rtuId must be null, got ${JSON.stringify(manual?.rtuId)}`);
  assert(
    manual?.rtuDisplayName === null,
    `unwired row rtuDisplayName must be null, got ${JSON.stringify(manual?.rtuDisplayName)}`,
  );
  assert(
    manual?.telemetrySource === null,
    `a row with no meta.telemetrySource key reports null, never a derived value, got ${JSON.stringify(manual?.telemetrySource)}`,
  );
  assert(manual?.active === true, `unwired row active must be true, got ${JSON.stringify(manual?.active)}`);
}

/**
 * G2 — after the join, a `location_admin`'s rows stay inside its grants. The
 * grant set and the out-of-scope set are both read by independent SQL keyed on
 * `location_id` (set reads, never positional); both are non-empty as controls
 * so the two "nothing outside" checks cannot pass vacuously.
 *
 * What this proves is `readableAssetIds` containment through `listAll`, and it
 * reddens when the `inArray(assets.id, assetIds)` term is dropped. It cannot
 * redden for "the join widened the rows": a LEFT JOIN on `rtus.id` (a primary
 * key) adds columns, never rows. G3 (its own suite) covers the join's other
 * failure — a foreign RTU's name on a mis-stamped row.
 */
export async function assertListAllStaysInsideLocationAdminScope(
  pool: pg.Pool,
  authDb: BmsDb,
  fleetDb: BmsDb,
): Promise<void> {
  const ids = await new AccessControlService(authDb, fleetDb).readableAssetIds(
    jwtFor(SEEDED.locationAdmin, "location_admin"),
  );
  assert(ids !== null, "a location_admin is never unrestricted");
  const rows = await new AssetsService(fleetDb).listAll(ids);
  assert(rows.length > 0, "control: the seeded location_admin reads at least one asset");

  const { rows: grants } = await pool.query<{ id: string }>(
    `SELECT ula.location_id AS id
       FROM bms.user_location_access ula
       JOIN bms.users u ON u.id = ula.user_id
      WHERE u.email = $1`,
    [SEEDED.locationAdmin],
  );
  const granted = new Set(grants.map((g) => g.id));
  assert(granted.size > 0, "control: the seeded location_admin holds at least one location grant");

  const outsideGrants = rows.filter((row) => !granted.has(row.locationId));
  assert(
    outsideGrants.length === 0,
    `every listed row must sit in a granted location, found: ${outsideGrants.map((r) => r.code).join(", ")}`,
  );

  const { rows: foreign } = await pool.query<{ id: string }>(
    `SELECT a.id
       FROM bms.assets a
      WHERE a.organization_id = (SELECT id FROM bms.organizations WHERE code = 'ESKOM')
        AND a.location_id <> ALL($1::uuid[])`,
    [[...granted]],
  );
  assert(foreign.length > 0, "control: ESKOM holds assets outside the location_admin's grants");
  const listed = new Set(rows.map((row) => row.id));
  const leaked = foreign.filter((f) => listed.has(f.id));
  assert(
    leaked.length === 0,
    `the join must not widen scope; out-of-grant assets in the list: ${leaked.map((f) => f.id).join(", ")}`,
  );
}

