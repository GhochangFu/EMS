import { POINT_KEY_STATE_SEED } from "@bms/db";

/**
 * `F4.309` / ADR 0088 Amendment 3 decision 3 (owner ruling Q3 (a)) — the seeded pairs, keyed
 * `<code>\u0000<value>`. A code is a catalog code (`CATALOG_CODE_PATTERN`: no NUL), so the key
 * cannot collide.
 */
const SEEDED = new Set(POINT_KEY_STATE_SEED.map((row) => pairKey(row.pointKeyCode, row.value)));

function pairKey(pointKey: string, value: number): string {
  return `${pointKey}\u0000${value}`;
}

/**
 * Whether `(pointKey, value)` is a row of `POINT_KEY_STATE_SEED`. A seeded row is seed-owned
 * (`ON CONFLICT DO UPDATE`), so the admin routes show it read-only and answer 409 to a write of it.
 * The comparison is exact: the seed's values are whole numbers, and `value` is the column's
 * `double precision` read back as a JavaScript number.
 */
export function isSeededPointKeyState(pointKey: string, value: number): boolean {
  return SEEDED.has(pairKey(pointKey, value));
}
