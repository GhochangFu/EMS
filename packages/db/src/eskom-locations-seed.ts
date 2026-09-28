import { eq } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "./client";
import { mapLocationRowsForInsert } from "./map-locations-seed";
import { pheMapLocationRowsForInsert } from "./phe-map-seed";
import { loadPheCatalog, type PheCatalogFile } from "./phe-pilot-seed";
import { mapLocations } from "./schema/bms-schema";
import { SEED_LOCATION_KEY } from "./seed-location-key";

/**
 * Map-marker and canonical-location seeding, split out of `seed.ts` to keep it
 * under the AGENTS.md §4.5 1000-line cap. The move was pure; since then
 * `seedEskomLocations` finds its rows by a stable key and pre-reads a held
 * slug or code (owner ruling 16, see its docblock).
 */

/** One row of the combined Eskom + PHE map-marker dataset. */
export type MapLocationSeedRow =
  | ReturnType<typeof mapLocationRowsForInsert>[number]
  | ReturnType<typeof pheMapLocationRowsForInsert>[number];

/**
 * The combined ESKOM + PHE map rows `seed.ts` seeds from — one list, so the
 * boot gate's expectations (`hierarchyExpectations`) read the rows the seed
 * writes rather than a second list built beside it. `pheCatalog` is the
 * catalog the caller has read, so the file is read once.
 */
export function seedMapLocationRows(pheCatalog: PheCatalogFile = loadPheCatalog()): MapLocationSeedRow[] {
  return [...mapLocationRowsForInsert(), ...pheMapLocationRowsForInsert(pheCatalog)];
}

const locationCodeByProvince = new Map([
  ["Eastern Cape", "EC"],
  ["Free State", "FS"],
  ["Gauteng", "GP"],
  ["KwaZulu-Natal", "KZN"],
  ["Limpopo", "LP"],
  ["Mpumalanga", "MP"],
  ["North West", "NW"],
  ["Northern Cape", "NC"],
  ["Western Cape", "WC"],
]);

/** Province short code, falling back to the slug's initials. */
export function locationCode(slug: string, province: string | null): string {
  if (province) {
    const code = locationCodeByProvince.get(province);
    if (code) {
      return code;
    }
  }
  return slug
    .split("-")
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 8);
}

/** Province short code for the RSMOC demo-asset prefix, or undefined. */
export function provinceCode(province: string): string | undefined {
  return locationCodeByProvince.get(province);
}

/** Inserts map markers that do not already exist, keyed by slug. */
export async function seedMapLocations(
  db: BmsDb,
  mapLocationRows: readonly MapLocationSeedRow[],
): Promise<void> {
  for (const row of mapLocationRows) {
    const exists = await db
      .select({ id: mapLocations.id })
      .from(mapLocations)
      .where(eq(mapLocations.slug, row.slug))
      .limit(1);
    if (exists[0]) {
      continue;
    }
    await db.insert(mapLocations).values({
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      siteName: row.siteName,
      latitude: row.latitude,
      longitude: row.longitude,
      capacityMw: row.capacityMw,
      stationType: row.stationType,
      stationCategory: row.stationCategory,
      province: row.province,
      stationOperatingStatus: row.stationOperatingStatus,
      meta: row.meta,
    });
  }
}

/**
 * The map rows `seedEskomLocations` turns into canonical ESKOM `bms.locations`
 * rows: the campus and centre kinds, less any row the PHE map marks as
 * PHEWB's. Exported so `verify-hierarchy-expected.ts` derives the canonical
 * location codes from the same filter the seed runs.
 */
export function eskomCanonicalLocationRows(
  mapLocationRows: readonly MapLocationSeedRow[],
): MapLocationSeedRow[] {
  return mapLocationRows.filter((item) => {
    if (!["smoc_campus", "rsmoc", "csmoc"].includes(item.kind)) {
      return false;
    }
    const isPhe =
      typeof item.meta === "object" &&
      item.meta !== null &&
      "organizationCode" in item.meta &&
      item.meta.organizationCode === "PHEWB";
    return !isPhe;
  });
}

/** The `bms.locations.code` `seedEskomLocations` writes for one canonical row. */
export function eskomLocationCode(row: MapLocationSeedRow): string {
  return `${row.kind.replace("_campus", "").toUpperCase()}-${locationCode(row.slug, row.province)}`;
}

export { SEED_LOCATION_KEY };

/** Enough of `pg.Pool` (or a checked-out client) to run one statement. */
export type LocationQueryable = Pick<pg.Pool, "query">;

/** What the seed writes to identify one of its locations. */
export type SeedLocationIdentity = {
  /** The `meta.seedKey` value: the canonical slug. */
  readonly key: string;
  readonly slug: string;
  readonly code: string;
};

/** The rows that claim one seed identity, and the one the seed adopts. */
export type SeedLocationCandidates = {
  /** The row the seed adopts, or `null` (none, or more than one and no rule picks one). */
  readonly id: string | null;
  /** Every candidate row, oldest first by `(created_at, id)`. */
  readonly candidates: readonly string[];
  /**
   * The candidates whose code, when read, is not the canonical code. When
   * the identity is ambiguous these still carry an administrator's code, and
   * the RTU step skips them (addendum 4 section 3).
   */
  readonly withoutCanonicalCode: readonly string[];
};

/**
 * The rows of `organizationId` that claim `identity`, and the one the seed
 * adopts (owner ruling 16, addendum 3 section 1). Read-only.
 *
 * A candidate is a row whose `meta.seedKey` is this key (K), or a row that has
 * the canonical slug (S) or code (C) and whose key is NULL or this key. A row
 * keyed for another identity is never a candidate, so a canonical row that
 * holds a second identity's slug cannot be taken for it.
 *
 * - No candidate: `id` is `null` and the caller inserts.
 * - One candidate row (it may be in K, S and C at once): adopted.
 * - More than one: the oldest by `(created_at, id)` is adopted when it is in
 *   K **and is the only row in K** (addendum 4). `created_at` has no admin
 *   write path, so a key forged onto a newer row cannot outrank the row the
 *   seed wrote. Two rows that carry the key are ambiguous, whatever their
 *   age: rows written in one transaction share `created_at`, the tie falls
 *   to a random `id`, and a forged key on the row that sorts first would
 *   otherwise take the identity. The admin API cannot write the key at all
 *   since owner ruling 20; this rule is what holds if one is there anyway.
 * - Otherwise `id` is `null` and `candidates` names them: the seed writes
 *   nothing for the identity and logs one line. Two unkeyed rows (a slug on
 *   one, the code on the other) cannot be told apart by any column the seed
 *   owns, and picking one would overwrite an administrator's row.
 *
 * Precedence, in short: the key restriction first (a row keyed for another
 * identity is never a candidate, by slug or by code), then a single
 * candidate, then the oldest-and-only keyed candidate, then nothing.
 *
 * `verify-hierarchy-seed.ts` reads the same candidates, so the boot gate and
 * the seed agree on which row is the identity's.
 */
export async function findSeedLocation(
  pool: LocationQueryable,
  organizationId: string,
  identity: SeedLocationIdentity,
): Promise<SeedLocationCandidates> {
  const found = await pool.query<{ id: string; keyed: boolean; code: string }>(
    `
    SELECT id, code, COALESCE(meta->>$5::text = $2, false) AS keyed
      FROM bms.locations
     WHERE organization_id = $1
       AND (meta->>$5::text = $2
            OR ((slug = $3 OR code = $4)
                AND (meta->>$5::text IS NULL OR meta->>$5::text = $2)))
     ORDER BY created_at, id
    `,
    // The key name is bound, not spliced into the text (compliance review B3).
    [organizationId, identity.key, identity.slug, identity.code, SEED_LOCATION_KEY],
  );
  const oldest = found.rows[0];
  const keyedCount = found.rows.filter((row) => row.keyed).length;
  const id =
    oldest === undefined
      ? null
      : found.rows.length === 1 || (oldest.keyed && keyedCount === 1)
        ? oldest.id
        : null;
  return {
    id,
    candidates: found.rows.map((row) => row.id),
    withoutCanonicalCode: found.rows.filter((row) => row.code !== identity.code).map((row) => row.id),
  };
}

/** Where one seed-owned location stands before the seed writes it. */
export type SeedLocationClaim = SeedLocationCandidates & {
  /**
   * `true` when more than one row claims the identity and none is adopted:
   * the seed writes nothing for it. The holders are then not read.
   */
  readonly ambiguous: boolean;
  /** Another row that holds the canonical slug (any organization), or `null`. */
  readonly slugHolder: string | null;
  /** Another row of the organization that holds the canonical code, or `null`. */
  readonly codeHolder: string | null;
};

/**
 * Finds the row the seed owns for `identity` ({@link findSeedLocation}), and
 * any other row that holds its canonical slug or code. The holders are read
 * before the write, and a held value is left out of it: a caught `23505` is
 * not an option, because the seed runs inside `withOrganization`'s one
 * transaction, which a failed statement aborts (`25P02`). The read and the
 * write are not atomic against a concurrent admin write; the seed's single
 * boot-time transaction is what it relies on.
 *
 * - **The slug holder**: on `slugReader`. `bms.locations.slug` is unique across
 *   every organization, and under `FORCE ROW LEVEL SECURITY` the caller's
 *   context sees only its own rows, so `seed.ts` passes its superuser pool
 *   (OQ2). A holder in another organization is then seen, not met as `23505`.
 * - **The code holder**: on `pool`. `(organization_id, code)` is the unique key,
 *   so the caller's own organization is the whole of it.
 */
export async function resolveSeedLocation(
  pool: LocationQueryable,
  slugReader: LocationQueryable,
  organizationId: string,
  identity: SeedLocationIdentity,
): Promise<SeedLocationClaim> {
  const found = await findSeedLocation(pool, organizationId, identity);
  const { id, candidates, withoutCanonicalCode } = found;
  if (id === null && candidates.length > 0) {
    return { ...found, ambiguous: true, slugHolder: null, codeHolder: null };
  }
  const slugHolder = await slugReader.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE slug = $1 AND id IS DISTINCT FROM $2::uuid`,
    [identity.slug, id],
  );
  const codeHolder = await pool.query<{ id: string }>(
    `SELECT id FROM bms.locations
      WHERE organization_id = $1 AND code = $2 AND id IS DISTINCT FROM $3::uuid`,
    [organizationId, identity.code, id],
  );
  return {
    id,
    candidates,
    withoutCanonicalCode,
    ambiguous: false,
    slugHolder: slugHolder.rows[0]?.id ?? null,
    codeHolder: codeHolder.rows[0]?.id ?? null,
  };
}

/**
 * One line per canonical value the seed cannot write for `claim`, naming the
 * seed's row and the row that holds the value. An INSERT cannot leave out a
 * NOT NULL column, so a held value on a row that does not exist yet means the
 * row is not inserted, and one line says so; the boot gate's presence count
 * then fails, which is the failure a missing canonical row should have. An
 * ambiguous claim is one line naming every candidate.
 */
export function seedLocationSkipLines(identity: SeedLocationIdentity, claim: SeedLocationClaim): string[] {
  const where = `seed location ${identity.key}`;
  if (claim.ambiguous) {
    return [
      `${where}: not written: locations ${claim.candidates.join(", ")} each claim it by key, slug or ` +
        "code, and the oldest is not the one row keyed for it",
    ];
  }
  if (claim.id === null) {
    const holder = claim.slugHolder ?? claim.codeHolder;
    if (holder === null) {
      return [];
    }
    const what = claim.slugHolder !== null ? `slug ${identity.slug}` : `code ${identity.code}`;
    return [`${where}: not inserted: location ${holder} already holds ${what}`];
  }
  const lines: string[] = [];
  if (claim.slugHolder !== null) {
    lines.push(`${where}: kept the slug of location ${claim.id}: location ${claim.slugHolder} holds ${identity.slug}`);
  }
  if (claim.codeHolder !== null) {
    lines.push(`${where}: kept the code of location ${claim.id}: location ${claim.codeHolder} holds ${identity.code}`);
  }
  return lines;
}

/** The identity `seedEskomLocations` gives one canonical row: key and slug are the row's slug. */
export function eskomSeedLocationIdentity(row: MapLocationSeedRow): SeedLocationIdentity {
  return { key: row.slug, slug: row.slug, code: eskomLocationCode(row) };
}

/** What the seed wrote for one identity (owner ruling 17). */
export type SeedLocationOutcome = {
  /** The row the seed adopted or inserted, or `null` when it wrote none. */
  readonly id: string | null;
  /** Whether that row carries the canonical code after the write. */
  readonly codeWritten: boolean;
  /**
   * When the identity was ambiguous (no row written): the candidates that do
   * not carry the canonical code. {@link seedLocationOutcome} always sets it;
   * it is optional only so a caller's literal for a resolved row need not.
   */
  readonly ambiguousWithoutCode?: readonly string[];
};

/** One {@link SeedLocationOutcome} per identity key. */
export type SeedLocationOutcomes = ReadonlyMap<string, SeedLocationOutcome>;

/**
 * The outcome of a write for `claim`: the adopted row, with its code written
 * unless another row holds it; the inserted row; or no row.
 */
export function seedLocationOutcome(claim: SeedLocationClaim, insertedId: string | null): SeedLocationOutcome {
  const ambiguousWithoutCode = claim.ambiguous ? claim.withoutCanonicalCode : [];
  if (claim.id !== null) {
    return { id: claim.id, codeWritten: claim.codeHolder === null, ambiguousWithoutCode };
  }
  return { id: insertedId, codeWritten: insertedId !== null, ambiguousWithoutCode };
}

/**
 * The seed rows whose canonical code was not written: another row holds it,
 * so the row still carries an administrator's code. `ensureEskomDomainRtus`
 * skips them (owner ruling 17) — its RTU codes derive from the location's
 * code, so writing them would give the row a second, permanent RTU set under
 * the administrator's code.
 *
 * An ambiguous identity has no seed row, but each of its candidates that
 * does not carry the canonical code is skipped too (addendum 4 section 3):
 * before the first keyed boot, a canonical row whose code was renamed while
 * another row took the code is one such candidate, and it would otherwise get
 * a second RTU set under the renamed code. The candidate that carries the
 * canonical code is not skipped: its RTUs are the seed's codes. Nor is a
 * row another identity adopted with its code written: an unkeyed row can be
 * one identity's candidate by slug and another's by code, and the codes were
 * read before that write.
 */
export function locationIdsWithoutSeedCode(outcomes: Iterable<SeedLocationOutcome>): Set<string> {
  const ids = new Set<string>();
  const written = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.id !== null && outcome.codeWritten) {
      written.add(outcome.id);
    }
    if (outcome.id !== null && !outcome.codeWritten) {
      ids.add(outcome.id);
    }
    for (const id of outcome.ambiguousWithoutCode ?? []) {
      ids.add(id);
    }
  }
  for (const id of written) {
    ids.delete(id);
  }
  return ids;
}

/**
 * Upserts the canonical `bms.locations` rows for Eskom campuses and centres,
 * and returns what it wrote for each, by key, for the steps that act on those
 * rows (owner ruling 17: the control-room view and the simulator RTUs use
 * the row resolved here, never a row found by code).
 *
 * **The seed owns each row's slug and code** (owner ruling 16). The row is
 * found by its `meta.seedKey` ({@link findSeedLocation}), so an administrator
 * who PATCHes a canonical location's slug or code has the value restored on
 * the next boot, on the same row, unless another row now holds it. It used to
 * be found by slug alone: a renamed slug made the seed INSERT a second row
 * with the canonical code, and the boot stopped with `23505`.
 *
 * A canonical value another row holds is left as it is, with one log line
 * naming both rows, and the rest of the row is written. An identity more than
 * one row claims is not written at all, with one line naming every candidate,
 * unless the oldest is the one row keyed for it. `slugReader` must see every organization —
 * `seed.ts` passes its superuser pool (OQ2). `pool` holds ESKOM's tenant
 * context. `meta` is written whole, as before, with the key.
 *
 * **Residuals** (to be recorded in `F4.172`, a row reserved for this PR's
 * closure, which lands after the merge), each a state no rule here can
 * resolve without overwriting an administrator's row:
 * - before the first keyed boot, an administrator renames both the slug and
 *   the code of a canonical row and gives the canonical slug to another row:
 *   that row is the only candidate and is adopted;
 * - an administrator wipes a canonical row's key, renames both its slug and
 *   its code, and forges the key onto another row: the forged row is the only
 *   candidate and is adopted;
 * - two keyed canonical rows swap slugs: each keeps the other's slug, and the
 *   seed logs both on every boot and never repairs them;
 * - before the first keyed boot, a canonical row whose code (or slug) was
 *   renamed while another row took it is ambiguous: nothing is written for
 *   the identity, on every boot, until an administrator resolves it. The RTU
 *   step skips the candidate without the canonical code (addendum 4);
 * - name and coordinates are not written on an ambiguous identity either:
 *   the oldest candidate can be the wrong row in a slug swap. So when an
 *   ambiguous site's name was also changed, `seedEskomAssets`, which finds
 *   its RTU by the catalog's site name, still throws, loudly (C4);
 * - when RSMOC-WC's identity is ambiguous, `seedScopedDemoUsers` gets no row
 *   and grants nothing: on a database where they are new, wc-admin has no
 *   location and wc-hvac-admin no `hvac` group (found under that row);
 * - `seedAccessControlFixtures` hosts `ESK-MANUAL-01` at the active ESKOM
 *   location with the lowest code, not at a seed identity, and its upsert
 *   moves `location_id` on every boot: an administrator location coded like
 *   `AA` takes the fixture on the next boot (owner ruling: recorded, not
 *   fixed here);
 * - the slug holder is read on the superuser pool, a second connection that
 *   cannot see this boot's uncommitted writes, so it can report a holder
 *   whose slug an earlier write of the same boot already moved: the slug is
 *   then skipped and logged, and written on the next boot. The same holds
 *   for `seedDecommissionedLocation`'s read of `esk-decomm-01`.
 *
 * Owner ruling 20 closed the admin path to the key itself: the location POST,
 * PATCH and the onboarding commit never write `meta.seedKey`, so a forged,
 * moved or wiped key needs a direct database write.
 */
export async function seedEskomLocations(
  pool: LocationQueryable,
  slugReader: LocationQueryable,
  mapLocationRows: readonly MapLocationSeedRow[],
  eskomOrgId: string,
  log: (line: string) => void = (line) => console.error(line),
): Promise<Map<string, SeedLocationOutcome>> {
  const outcomes = new Map<string, SeedLocationOutcome>();
  for (const row of eskomCanonicalLocationRows(mapLocationRows)) {
    const capital =
      typeof row.meta === "object" &&
      row.meta !== null &&
      "capital" in row.meta &&
      typeof row.meta.capital === "string"
        ? row.meta.capital
        : null;
    const identity = eskomSeedLocationIdentity(row);
    const claim = await resolveSeedLocation(pool, slugReader, eskomOrgId, identity);
    for (const line of seedLocationSkipLines(identity, claim)) {
      log(line);
    }
    const meta = JSON.stringify({ ...row.meta, [SEED_LOCATION_KEY]: identity.key });
    // E4.1b (ADR 0070 decision 6): the Eskom demo estate keeps SAST.
    // Seed-owned like `latitude` (ruled 2026-09-19 at the PR 1 review): the
    // zone is a fact of the site, so a re-seed re-asserts it — unlike
    // `ingest_enabled` (F1.7), which an operator owns.
    const values = {
      name: row.name,
      type: row.kind,
      province: row.province,
      capital,
      latitude: row.latitude,
      longitude: row.longitude,
      timezone: "Africa/Johannesburg",
      meta,
    };
    let insertedId: string | null = null;
    if (claim.ambiguous) {
      // Nothing is written for this identity; the line above names every
      // candidate.
    } else if (claim.id !== null) {
      // The row was found in `eskomOrgId`, so its organization is not written.
      await pool.query(
        `
        UPDATE bms.locations SET
          slug = CASE WHEN $2::boolean THEN $3 ELSE slug END,
          code = CASE WHEN $4::boolean THEN $5 ELSE code END,
          name = $6, type = $7, province = $8, capital = $9,
          latitude = $10, longitude = $11, timezone = $12, active = true,
          meta = $13::jsonb, updated_at = now()
        WHERE id = $1
        `,
        [
          claim.id,
          claim.slugHolder === null,
          identity.slug,
          claim.codeHolder === null,
          identity.code,
          values.name,
          values.type,
          values.province,
          values.capital,
          values.latitude,
          values.longitude,
          values.timezone,
          values.meta,
        ],
      );
    } else if (claim.slugHolder === null && claim.codeHolder === null) {
      const inserted = await pool.query<{ id: string }>(
        `
        INSERT INTO bms.locations
          (organization_id, code, slug, name, type, province, capital, latitude, longitude,
           timezone, active, meta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11::jsonb)
        RETURNING id
        `,
        [
          eskomOrgId,
          identity.code,
          identity.slug,
          values.name,
          values.type,
          values.province,
          values.capital,
          values.latitude,
          values.longitude,
          values.timezone,
          values.meta,
        ],
      );
      insertedId = inserted.rows[0]?.id ?? null;
    }
    outcomes.set(identity.key, seedLocationOutcome(claim, insertedId));
  }
  return outcomes;
}

/** Renames the pre-rebrand `smoc-cape-town` marker to `rsmoc-western-cape`. */
export async function renameLegacyCapeTownMapLocation(
  db: BmsDb,
  mapLocationRows: readonly MapLocationSeedRow[],
): Promise<void> {
  const westernCapeLocation = mapLocationRows.find(
    (row) => row.slug === "rsmoc-western-cape",
  );
  if (!westernCapeLocation) {
    return;
  }
  const existingWesternCape = await db
    .select({ id: mapLocations.id })
    .from(mapLocations)
    .where(eq(mapLocations.slug, westernCapeLocation.slug))
    .limit(1);
  const legacyCapeTown = await db
    .select({ id: mapLocations.id })
    .from(mapLocations)
    .where(eq(mapLocations.slug, "smoc-cape-town"))
    .limit(1);
  if (!existingWesternCape[0] && legacyCapeTown[0]) {
    await db
      .update(mapLocations)
      .set({
        slug: westernCapeLocation.slug,
        name: westernCapeLocation.name,
        kind: westernCapeLocation.kind,
        siteName: westernCapeLocation.siteName,
        latitude: westernCapeLocation.latitude,
        longitude: westernCapeLocation.longitude,
        capacityMw: westernCapeLocation.capacityMw,
        stationType: westernCapeLocation.stationType,
        stationCategory: westernCapeLocation.stationCategory,
        province: westernCapeLocation.province,
        stationOperatingStatus: westernCapeLocation.stationOperatingStatus,
        meta: westernCapeLocation.meta,
      })
      .where(eq(mapLocations.id, legacyCapeTown[0].id));
  }
}
