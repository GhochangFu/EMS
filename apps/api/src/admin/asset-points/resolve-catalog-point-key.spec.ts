import type pg from "pg";

import type { BmsDb } from "@bms/db";

import type { resolveCatalogPointKey as ResolveCatalogPointKeyFn } from "./resolve-catalog-point-key";

/**
 * `resolveCatalogPointKey` — the org-catalog check `AssetPointsAdminService`
 * held privately, extracted so `F1.9` (bulk import) can report it per row
 * instead of aborting the whole file on the first bad point key.
 *
 * **Non-throwing is the point.** The original `private` method threw
 * `BadRequestException`, which is right for a single mapped-point request but
 * wrong for a batch: F1.9 needs `{ ok: false; reason }` for row N while rows
 * N+1..M keep going. `AssetPointsAdminService.create`/`update` translate
 * `ok:false` back into the same `BadRequestException` they threw before, with
 * the message preserved verbatim — this suite is what proves that carry-over,
 * not just the new function in isolation.
 */
export type Fixtures = {
  /** An asset (any) plus its resolved organization, from a real location join. */
  assetId: string;
  organizationId: string;
  /** One active point-key code in that organization, with its catalog unit. */
  activePointKey: { code: string; unit: string | null };
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function loadFixtures(pool: pg.Pool): Promise<Fixtures> {
  const { rows: assetRows } = await pool.query<{
    asset_id: string;
    organization_id: string;
  }>(
    `SELECT a.id AS asset_id, l.organization_id
       FROM bms.assets a
       JOIN bms.locations l ON l.id = a.location_id
      WHERE l.active = true
      ORDER BY a.code
      LIMIT 1`,
  );
  const asset = assetRows[0];
  if (!asset) {
    throw new Error(
      "resolve-catalog-point-key fixtures missing — no asset with an active location. " +
        "Run 'pnpm db:seed'.",
    );
  }

  const { rows: keyRows } = await pool.query<{ code: string; unit: string | null }>(
    `SELECT code, unit FROM bms.point_keys
      WHERE organization_id = $1 AND active = true
      ORDER BY created_at, code LIMIT 1`,
    [asset.organization_id],
  );
  const activePointKey = keyRows[0];
  if (!activePointKey) {
    throw new Error(
      "resolve-catalog-point-key fixtures missing — the asset's organization has no active " +
        "point key. Run 'pnpm db:seed'.",
    );
  }

  return { assetId: asset.asset_id, organizationId: asset.organization_id, activePointKey };
}

export async function runResolveCatalogPointKeyTests(
  db: BmsDb,
  resolve: typeof ResolveCatalogPointKeyFn,
  fx: Fixtures,
): Promise<void> {
  // ---- good key ---------------------------------------------------------

  const good = await resolve(db, fx.assetId, fx.activePointKey.code);
  assert(good.ok === true, `a good key must resolve: ${JSON.stringify(good)}`);
  if (good.ok) {
    assert(
      good.unit === fx.activePointKey.unit,
      `resolved unit must match the catalog row (got ${good.unit}, want ${fx.activePointKey.unit})`,
    );
    assert(
      good.organizationId === fx.organizationId,
      "resolved organizationId must be the asset's own organization",
    );
  }

  // ---- unknown point key --------------------------------------------------

  const unknownCode = `F18-NO-SUCH-KEY-${Date.now()}`;
  const unknown = await resolve(db, fx.assetId, unknownCode);
  assert(
    unknown.ok === false,
    "an unknown point key must not resolve",
  );
  if (!unknown.ok) {
    assert(
      /Point key must exist in the organization catalog and be active/.test(unknown.reason),
      `rejection message must be preserved verbatim from the original service: got "${unknown.reason}"`,
    );
  }

  // ---- asset with no organization (unknown assetId) ------------------------

  const noSuchAsset = "00000000-0000-4000-8000-000000000000";
  const noOrg = await resolve(db, noSuchAsset, fx.activePointKey.code);
  assert(noOrg.ok === false, "a nonexistent asset must not resolve");
  if (!noOrg.ok) {
    assert(
      /Asset must belong to a location with an organization/.test(noOrg.reason),
      `rejection message must be preserved verbatim from the original service: got "${noOrg.reason}"`,
    );
  }
}
