import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect } from "vitest";

import { DECOMMISSIONED_LOCATION_SLUG } from "./access-fixtures-seed";
import {
  eskomCanonicalLocationRows,
  eskomLocationCode,
  eskomSeedLocationIdentity,
  seedLocationSkipLines,
} from "./eskom-locations-seed";
import { mapLocationRowsForInsert } from "./map-locations-seed";
import { pheMapLocationRowsForInsert } from "./phe-map-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F4.169` / `F4.170` addendum 2, owner ruling 16 — the seed finds each
 * location it owns by `meta.seedKey`, valued as the canonical slug.
 *
 * The key is stamped on live rows at the first boot after this change and
 * read on every boot after it. A derivation that moved — the code instead of
 * the slug, or a slug that changed with the catalog — would orphan every
 * stamp, and the seed would adopt by slug or code again without saying so.
 * These pin the derivation.
 */

/** The rows `seed.ts` hands `seedEskomLocations`: the ESKOM and PHE map rows. */
function seedMapRows() {
  return [...mapLocationRowsForInsert(), ...pheMapLocationRowsForInsert()];
}

/** Every canonical ESKOM row's key is its slug, and its code is `eskomLocationCode`. */
export function assertEveryCanonicalKeyIsItsSlug(): void {
  const rows = eskomCanonicalLocationRows(seedMapRows());
  expect(rows.length, "the seed writes ten canonical ESKOM locations").toBe(10);
  for (const row of rows) {
    expect(eskomSeedLocationIdentity(row), `the identity of ${row.slug}`).toEqual({
      key: row.slug,
      slug: row.slug,
      code: eskomLocationCode(row),
    });
  }
}

/** Ten canonical keys and the decommissioned fixture's: eleven, all distinct. */
export function assertElevenDistinctSeedKeys(): void {
  const keys = [
    ...eskomCanonicalLocationRows(seedMapRows()).map((row) => eskomSeedLocationIdentity(row).key),
    DECOMMISSIONED_LOCATION_SLUG,
  ];
  expect(keys, "ten canonical locations and ESK-DECOMM-01").toHaveLength(11);
  expect(new Set(keys).size, "every seed key must be distinct").toBe(11);
}

const IDENTITY = { key: "rsmoc-western-cape", slug: "rsmoc-western-cape", code: "RSMOC-WC" };

/** A held slug on a found row is one line naming both rows; nothing held is no line. */
export function assertAHeldSlugIsOneLineNamingBothRows(): void {
  expect(seedLocationSkipLines(IDENTITY, { id: "row-a", slugHolder: null, codeHolder: null })).toEqual([]);
  const lines = seedLocationSkipLines(IDENTITY, { id: "row-a", slugHolder: "row-b", codeHolder: null });
  expect(lines, "one line for the held slug").toHaveLength(1);
  expect(lines[0]).toContain("row-a");
  expect(lines[0]).toContain("row-b");
  expect(lines[0]).toContain("rsmoc-western-cape");
}

/** A held value on a row that does not exist yet is one "not inserted" line. */
export function assertAHeldValueWithNoRowIsNotInserted(): void {
  const lines = seedLocationSkipLines(IDENTITY, { id: null, slugHolder: null, codeHolder: "row-b" });
  expect(lines, "one line: the row is not inserted").toEqual([
    "seed location rsmoc-western-cape: not inserted: location row-b already holds code RSMOC-WC",
  ]);
}

/**
 * `seed.ts` hands `seedEskomLocations` the superuser pool as the slug reader
 * (OQ2). The integration suite injects its own reader, so only this reads
 * the call `pnpm db:seed` makes.
 *
 * Mutation: passing `pool` twice fails here.
 */
export function assertTheSeedReadsSlugHoldersAsTheSuperuser(): void {
  // The two cwds the suite runs from (`pue-demo-seed.spec.ts`'s idiom:
  // `__dirname` does not exist under Vitest's ESM load).
  const candidates = ["src/seed.ts", "packages/db/src/seed.ts"];
  const path = candidates.map((c) => resolve(process.cwd(), c)).find((p) => existsSync(p));
  expect(path, `seed.ts not found from ${process.cwd()}`).toBeDefined();
  const seed = readFileSync(path as string, "utf8");
  expect(seed).toContain("await seedEskomLocations(pool, superuserPool, mapLocationRows, eskomOrgId);");
}
