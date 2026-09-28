import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect } from "vitest";

import { DECOMMISSIONED_LOCATION_SLUG } from "./access-fixtures-seed";
import {
  eskomCanonicalLocationRows,
  eskomLocationCode,
  eskomSeedLocationIdentity,
  locationIdsWithoutSeedCode,
  type SeedLocationClaim,
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

/** A claim that is not ambiguous, with nothing held unless `parts` says so. */
function claim(parts: Partial<SeedLocationClaim>): SeedLocationClaim {
  const id = parts.id ?? null;
  return {
    id,
    candidates: id === null ? [] : [id],
    withoutCanonicalCode: [],
    ambiguous: false,
    slugHolder: null,
    codeHolder: null,
    ...parts,
  };
}

/** An ambiguous claim is one line naming every candidate, and nothing about holders. */
export function assertAnAmbiguousClaimIsOneLineNamingEveryCandidate(): void {
  const lines = seedLocationSkipLines(
    IDENTITY,
    claim({ candidates: ["row-a", "row-b", "row-c"], ambiguous: true }),
  );
  expect(lines, "one line").toHaveLength(1);
  for (const id of ["row-a", "row-b", "row-c"]) {
    expect(lines[0], `the line names ${id}`).toContain(id);
  }
  expect(lines[0]).toContain("not written");
}

/** A held slug on a found row is one line naming both rows; nothing held is no line. */
export function assertAHeldSlugIsOneLineNamingBothRows(): void {
  expect(seedLocationSkipLines(IDENTITY, claim({ id: "row-a" }))).toEqual([]);
  const lines = seedLocationSkipLines(IDENTITY, claim({ id: "row-a", slugHolder: "row-b" }));
  expect(lines, "one line for the held slug").toHaveLength(1);
  expect(lines[0]).toContain("row-a");
  expect(lines[0]).toContain("row-b");
  expect(lines[0]).toContain("rsmoc-western-cape");
}

/**
 * A held value on a row that does not exist yet is one "not inserted" line.
 * Reachable under addendum 3's rule: a row keyed for another identity is not
 * a candidate, so it can hold this identity's code while no candidate exists.
 */
export function assertAHeldValueWithNoRowIsNotInserted(): void {
  const lines = seedLocationSkipLines(IDENTITY, claim({ codeHolder: "row-b" }));
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
  const seed = readSeedSource();
  expect(seed).toContain("await seedEskomLocations(pool, superuserPool, mapLocationRows, eskomOrgId);");
  // Mutation: passing `pool` as ESK-DECOMM-01's slug reader fails here.
  expect(seed).toContain("await seedDecommissionedLocation(pool, superuserPool, eskomOrgId);");
}

function readSeedSource(): string {
  // The two cwds the suite runs from (`pue-demo-seed.spec.ts`'s idiom:
  // `__dirname` does not exist under Vitest's ESM load).
  const candidates = ["src/seed.ts", "packages/db/src/seed.ts"];
  const path = candidates.map((c) => resolve(process.cwd(), c)).find((p) => existsSync(p));
  expect(path, `seed.ts not found from ${process.cwd()}`).toBeDefined();
  return readFileSync(path as string, "utf8");
}

/**
 * Addendum 3 section 2, in `seed.ts`'s own order, which an integration case
 * calling the functions in its own order cannot hold: in the first ESKOM
 * bracket, the canonical rows and ESK-DECOMM-01 are written before the view
 * and the RTU step, and the RTU step is handed both outcomes' skip set.
 *
 * Mutation: moving `seedDecommissionedLocation(` below
 * `ensureEskomDomainRtus(`, or dropping `decommissionedLocation` from the
 * skip set, fails here.
 */
export function assertTheRtuStepRunsAfterTheSeedRowsAndSkipsTheirHeldCodes(): void {
  const seed = readSeedSource();
  const start = seed.indexOf("withOrganization(pool, eskomOrgId, async () => {");
  const end = seed.indexOf("});", start);
  expect(start, "the first ESKOM bracket").toBeGreaterThan(-1);
  const bracket = seed.slice(start, end);
  const at = (call: string): number => bracket.indexOf(call);
  expect(at("seedEskomLocations("), "seedEskomLocations( in the first ESKOM bracket").toBeGreaterThan(-1);
  expect(at("seedDecommissionedLocation("), "ESK-DECOMM-01 after the canonical rows").toBeGreaterThan(
    at("seedEskomLocations("),
  );
  expect(at("seedSiteControlRoomViews("), "the view after both").toBeGreaterThan(at("seedDecommissionedLocation("));
  expect(at("ensureEskomDomainRtus("), "the RTU step after both").toBeGreaterThan(at("seedDecommissionedLocation("));
  const rtuCall = bracket.slice(at("ensureEskomDomainRtus("), bracket.indexOf(";", at("ensureEskomDomainRtus(")));
  expect(rtuCall.replace(/\s+/g, " ")).toContain(
    "locationIdsWithoutSeedCode([...seedLocations.values(), decommissionedLocation])",
  );
  expect(bracket).toContain("seedSiteControlRoomViews(db, eskomOrgId, seedLocations)");
}

/**
 * Addendum 4 section 3, owner ruling 17: `seed.ts` grants `wc-admin` the row
 * `seedEskomLocations` resolved for RSMOC-WC, not a row found by slug. The
 * integration case injects the id; only this reads the call `pnpm db:seed`
 * makes.
 *
 * Mutation: passing no resolved id, or reading it from another key, fails here.
 */
export function assertTheDemoUsersGetTheResolvedWesternCapeRow(): void {
  const seed = readSeedSource();
  expect(seed).toContain("westernCapeId = seedLocations.get(WC_ADMIN_LOCATION_KEY)?.id ?? null;");
  expect(seed).toContain("await seedScopedDemoUsers(identityDb, eskomOrgId, westernCapeId);");
}

/** A row whose held code was not written is skipped; an inserted or restored one is not. */
export function assertOnlyARowWithoutItsCodeIsSkipped(): void {
  expect(
    [
      ...locationIdsWithoutSeedCode([
        { id: "kept", codeWritten: true },
        { id: "held", codeWritten: false },
        { id: null, codeWritten: false },
      ]),
    ],
  ).toEqual(["held"]);
}

/**
 * Addendum 4 section 3: an ambiguous identity's candidates without the
 * canonical code are skipped; a row another identity wrote its code on is not.
 */
export function assertAnAmbiguousIdentitysCandidatesWithoutTheCodeAreSkipped(): void {
  expect(
    [
      ...locationIdsWithoutSeedCode([
        { id: null, codeWritten: false, ambiguousWithoutCode: ["renamed", "also-renamed"] },
        { id: "kept", codeWritten: true, ambiguousWithoutCode: [] },
      ]),
    ].sort(),
  ).toEqual(["also-renamed", "renamed"]);
  expect(
    [
      ...locationIdsWithoutSeedCode([
        { id: null, codeWritten: false, ambiguousWithoutCode: ["other-identitys-row"] },
        { id: "other-identitys-row", codeWritten: true },
      ]),
    ],
    "a row another identity adopted with its code written gets its RTUs",
  ).toEqual([]);
}
