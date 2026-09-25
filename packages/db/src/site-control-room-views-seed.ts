import { eq } from "drizzle-orm";

import type { BmsDb } from "./client";
import { locations, siteControlRoomViews } from "./schema";

/**
 * `F3.67` (ADR 0076 decision 6, owner ruling OQ2). Seeds the ESKOM demo's
 * Control Room built-in view for `RSMOC-WC` — the site the mockup shows.
 *
 * **Insert-if-absent, never insert-if-absent-then-overwrite.** `onConflictDoNothing`
 * is load-bearing: an administrator's own choice of view for this site (or any
 * later re-seed after one) must survive a re-run of `pnpm db:seed`, the same
 * ownership rule `F1.7` established for `ingest_enabled` — a re-seed asserts
 * the row exists at all, not what it currently holds.
 */
export async function seedSiteControlRoomViews(db: BmsDb, eskomOrgId: string): Promise<void> {
  const [rsmocWc] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.code, "RSMOC-WC"))
    .limit(1);
  if (!rsmocWc) {
    throw new Error(
      "seedSiteControlRoomViews: no bms.locations row for code RSMOC-WC — run after seedEskomLocations",
    );
  }

  // A local variable, not an inline literal: `tests/`'s combined `tsc
  // --moduleResolution bundler` pass resolves drizzle-orm's ESM typings,
  // under which excess-property checking on an inline `.values({...})`
  // literal rejects `builtinKey` — the `eskom-locations-seed.ts` precedent
  // for the same reason.
  const values = {
    locationId: rsmocWc.id,
    organizationId: eskomOrgId,
    kind: "builtin" as const,
    builtinKey: "smoc" as const,
  };
  await db.insert(siteControlRoomViews).values(values).onConflictDoNothing();
}
