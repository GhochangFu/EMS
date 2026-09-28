import type { BmsDb } from "./client";
import { siteControlRoomViews } from "./schema";

/**
 * The part of `seedEskomLocations`' outcome map (`SeedLocationOutcomes`) this
 * seed reads: the row resolved per identity key. Stated here, not imported:
 * `tests/f3.67-site-control-room-views-seed.integration.test.ts` loads this
 * module from `src`, and the root `typecheck:tests` call type-checks every
 * file it reaches non-strictly, where `eskom-locations-seed.ts`'s drizzle
 * inserts fail (`TS2769`, `TS2353`).
 */
export type ResolvedSeedLocations = ReadonlyMap<string, { readonly id: string | null }>;

/** The seed key (the canonical slug) of `RSMOC-WC`, the site the view is seeded for. */
export const CONTROL_ROOM_VIEW_LOCATION_KEY = "rsmoc-western-cape";

/**
 * `F3.67` (ADR 0076 decision 6, owner ruling OQ2). Seeds the ESKOM demo's
 * Control Room built-in view for `RSMOC-WC` — the site the mockup shows.
 *
 * **Insert-if-absent, never insert-if-absent-then-overwrite.** `onConflictDoNothing`
 * is load-bearing: an administrator's own choice of view for this site (or any
 * later re-seed after one) must survive a re-run of `pnpm db:seed`, the same
 * ownership rule `F1.7` established for `ingest_enabled` — a re-seed asserts
 * the row exists at all, not what it currently holds.
 *
 * **On the row `seedEskomLocations` resolved for `RSMOC-WC`'s identity**
 * (owner ruling 17), never on a row found by code: an administrator's
 * location may hold the code `RSMOC-WC` while the seed's row keeps another.
 * When the location seed wrote no row for the identity (more than one row
 * claims it, or a holder blocked the insert, each already logged), no view is
 * written and one line says so.
 */
export async function seedSiteControlRoomViews(
  db: BmsDb,
  eskomOrgId: string,
  seedLocations: ResolvedSeedLocations,
  log: (line: string) => void = (line) => console.error(line),
): Promise<void> {
  const outcome = seedLocations.get(CONTROL_ROOM_VIEW_LOCATION_KEY);
  if (!outcome) {
    throw new Error(
      `seedSiteControlRoomViews: no seedEskomLocations outcome for ${CONTROL_ROOM_VIEW_LOCATION_KEY} — ` +
        "pass the map seedEskomLocations returns",
    );
  }
  if (outcome.id === null) {
    log(
      `seedSiteControlRoomViews: no control room view written: seedEskomLocations wrote no row for ` +
        CONTROL_ROOM_VIEW_LOCATION_KEY,
    );
    return;
  }
  const rsmocWc = { id: outcome.id };

  // A local variable, not an inline literal. The root `typecheck:tests`
  // script's combined `tsc` call passes its files on the command line, so no
  // tsconfig applies and `tsconfig.base.json`'s `strict: true` is off there.
  // Without `strictNullChecks`, drizzle's insert type keeps only the columns an
  // insert must supply (NOT NULL with no default: `locationId`,
  // `organizationId`, `kind`) and drops every optional one, so
  // excess-property checking on an inline `.values({...})` literal rejects
  // `builtinKey`. A variable is not subject to that check — the
  // `eskom-locations-seed.ts` precedent for the same reason.
  const values = {
    locationId: rsmocWc.id,
    organizationId: eskomOrgId,
    kind: "builtin" as const,
    builtinKey: "smoc" as const,
  };
  await db.insert(siteControlRoomViews).values(values).onConflictDoNothing();
}
