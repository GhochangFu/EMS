import type { EnergyFilterLocation } from "@bms/shared";

/**
 * `F4.298` U4 (ADR 0108 decision 2.7) — the `/auth/me` parent rule for the
 * energy filter's location list, pure. A parent the caller can read is named;
 * a parent outside the caller's own rows is `null`, the value a root carries,
 * so the filter never sends the id of a node its reader cannot see.
 *
 * Written here rather than imported: `withVisibleParents`
 * (`auth/access-scope-sources.ts`) is module-private and typed to the scope's
 * location shape. "Readable" is the row set the caller was answered with —
 * nothing is re-read to decide it.
 */
export function nullUnreadableParents(rows: readonly EnergyFilterLocation[]): EnergyFilterLocation[] {
  const readable = new Set(rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    parentId: row.parentId !== null && readable.has(row.parentId) ? row.parentId : null,
  }));
}
