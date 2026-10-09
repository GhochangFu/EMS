/**
 * `F2.10` (ADR 0098, Amendment 1) — the deepest a `bms.locations` tree may go.
 * Root = depth 1. Declared once here; migration `0103`'s trigger and the
 * recursive CTEs in `apps/api/src/auth/location-tree.ts` use the same number,
 * and `tests/f2.10-location-tree-migration.test.ts` pins the SQL literal to
 * this constant. In its own file because `./constants` is at the §4.5 cap.
 */
export const LOCATION_TREE_MAX_DEPTH = 8;
