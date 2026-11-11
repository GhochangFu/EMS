import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { UserRole } from "@bms/shared";

import { readScopeSourcesForRole } from "../../auth/access-scope";

type Rows<T> = { rows: T[] };
const rowsOf = <T>(result: unknown): T[] => (result as Rows<T>).rows;

const GRANT_KINDS = new Set(["organization", "location", "asset_group"]);

/**
 * `F4.340` / ADR 0128 Q6 — which of `users` hold a grant **in effect**, for
 * the Users list's "No access" flag. An `admin` always does (its source is
 * `global`). Any other role does when at least one grant source its role reads
 * (`readScopeSourcesForRole`) **yields** — the same rule as
 * `readScopeSourceYields`, and so as the Grants drawer's `effective`: an
 * organization grant with an active location in it, a location grant to an
 * active location, or an asset-group grant whose location is active. A user
 * whose only grant reaches no active site sees nothing, and is flagged.
 *
 * One query on `fleetDb` (`bms_fleet`, `BYPASSRLS`): it runs before any tenant
 * context, across the listed users' organizations, and is filtered by the
 * listed user ids — the rows the caller's list already chose.
 */
export async function usersWithAnEffectiveGrant(
  db: Pick<BmsDb, "execute">,
  users: readonly { readonly id: string; readonly role: UserRole }[],
): Promise<Set<string>> {
  const result = new Set(users.filter((user) => user.role === "admin").map((user) => user.id));
  const scoped = users.filter((user) => user.role !== "admin");
  if (scoped.length === 0) {
    return result;
  }
  const ids = `{${scoped.map((user) => user.id).join(",")}}`;
  const held = new Map<string, Set<string>>();
  const rows = rowsOf<{ user_id: string; kind: string }>(
    await db.execute(sql`
      SELECT DISTINCT a.user_id, 'organization' AS kind FROM bms.user_organization_access a
        JOIN bms.locations l ON l.organization_id = a.organization_id AND l.active
       WHERE a.user_id = ANY(${ids}::uuid[])
      UNION
      SELECT a.user_id, 'location' AS kind FROM bms.user_location_access a
        JOIN bms.locations l ON l.id = a.location_id AND l.active
       WHERE a.user_id = ANY(${ids}::uuid[])
      UNION
      SELECT a.user_id, 'asset_group' AS kind FROM bms.user_asset_group_access a
        JOIN bms.asset_groups g ON g.id = a.asset_group_id
        JOIN bms.locations l ON l.id = g.location_id AND l.active
       WHERE a.user_id = ANY(${ids}::uuid[])
    `),
  );
  for (const row of rows) {
    held.set(row.user_id, (held.get(row.user_id) ?? new Set()).add(row.kind));
  }
  for (const user of scoped) {
    const kinds = held.get(user.id);
    const reads = readScopeSourcesForRole(user.role).filter((source) => GRANT_KINDS.has(source));
    if (kinds && reads.some((source) => kinds.has(source))) {
      result.add(user.id);
    }
  }
  return result;
}
