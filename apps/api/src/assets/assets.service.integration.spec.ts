import { eq } from "drizzle-orm";

import { organizations } from "@bms/db";
import type { BmsDb } from "@bms/db";

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
