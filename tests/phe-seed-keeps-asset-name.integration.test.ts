import { afterAll, beforeAll, describe, it } from "vitest";

// Relative, not `@bms/db`: the workspace package is a dependency of `apps/*`,
// not of the repo root, so the bare specifier does not resolve from `tests/`.
import { createDb } from "../packages/db/src/client.js";
import { seedPheCatalog } from "../packages/db/src/phe-pilot-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * The PHE seed names an asset when it creates it, and never again.
 *
 * Every deploy runs `db:seed`, and the seed used to write the vendor's
 * `DeviceDisplayName` on every pass, so an operator's rename of a PHE asset
 * (the AWS demo names them by RTU) lasted only until the next merge. One seed
 * pass cannot reach this branch — on a fresh database every row is an insert —
 * so this seeds, renames the way the admin asset page does, and seeds again.
 *
 * The same two-pass shape as `f1.7-seed-ownership.integration.test.ts`, and the
 * same rule (ADR 0007 decision 4a: the seed asserts once, then the operator owns it).
 */

const connectionString = requireIntegrationDb({
  item: "PHE seed asset name",
  label: "PHE seed asset-name tests",
  because:
    "whether a second `pnpm db:seed` reverts an operator's asset name is a " +
    "database behaviour across two passes, so a green run without one asserts nothing.",
});

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A catalog asset; its vendor name is `DEVICE - PHEWB - MFM-000000003`. */
const ASSET_CODE = "PHE-MFM-000000003";
const OPERATOR_NAME = "Lotapata I · Energy meter (MFM-000000003)";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

let pool: IntegrationPool | undefined;
let db: ReturnType<typeof createDb> | undefined;
let vendorName: string | undefined;

async function readAsset(): Promise<{ name: string; site_name: string }> {
  if (!pool) throw new Error("pool not initialised");
  const res = await pool.query<{ name: string; site_name: string }>(
    `SELECT name, site_name FROM bms.assets WHERE code = $1`,
    [ASSET_CODE],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error(`no bms.assets row for ${ASSET_CODE}`);
  return row;
}

async function rename(name: string): Promise<void> {
  if (!pool) throw new Error("pool not initialised");
  await pool.query(`UPDATE bms.assets SET name = $2 WHERE code = $1`, [ASSET_CODE, name]);
}

async function reseed(): Promise<void> {
  if (!db || !pool) throw new Error("pool not initialised");
  await seedPheCatalog(db, pool);
}

describe.skipIf(!connectionString)("PHE seed keeps an existing asset's name", () => {
  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "PHE seed asset name");
    db = createDb(pool);
    await reseed();
    vendorName = (await readAsset()).name;
  }, 120_000);

  afterAll(async () => {
    // Leave the asset with the name it had before the suite.
    if (vendorName !== undefined) await rename(vendorName);
    await pool?.end();
  }, 120_000);

  it("does not put the vendor name back on a renamed asset", async () => {
    await rename(OPERATOR_NAME);

    await reseed();

    const row = await readAsset();
    assert(
      row.name === OPERATOR_NAME,
      `a second seed pass must keep the operator's name, got "${row.name}"`,
    );
  }, 120_000);

  it("still writes the columns it owns on the same pass", async () => {
    if (!pool) throw new Error("pool not initialised");
    const before = await readAsset();
    await pool.query(`UPDATE bms.assets SET site_name = 'stale site' WHERE code = $1`, [ASSET_CODE]);

    await reseed();

    const row = await readAsset();
    assert(
      row.site_name === before.site_name,
      `the seed must still own site_name, got "${row.site_name}" (was "${before.site_name}")`,
    );
  }, 120_000);
});
