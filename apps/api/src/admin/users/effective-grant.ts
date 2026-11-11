import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type { UserRole } from "@bms/shared";

import { readScopeSourcesForRole } from "../../auth/access-scope";

type Rows<T> = { rows: T[] };
const rowsOf = <T>(result: unknown): T[] => (result as Rows<T>).rows;

const GRANT_KINDS = new Set(["organization", "location", "asset_group"]);

/**
 * `F4.340` / ADR 0128 Q6 — which of `users` hold a grant their role reads,
 * for the Users list's "No access" flag. An `admin` always does (its source
 * is `global`). Any other role does when it holds at least one grant of a kind
 * in `readScopeSourcesForRole(role)`; a `location_admin` holding only an
 * organization grant, say, does not.
 *
 * One query on `fleetDb` (`bms_fleet`, `BYPASSRLS`), filtered by the listed
 * user ids — the rows the caller's list already chose. It answers "is there
 * a grant row", not "does it reach an active site": a grant to an organization
 * with no active site is still a grant an administrator gave.
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
      SELECT user_id, 'organization' AS kind FROM bms.user_organization_access WHERE user_id = ANY(${ids}::uuid[])
      UNION
      SELECT user_id, 'location' AS kind FROM bms.user_location_access WHERE user_id = ANY(${ids}::uuid[])
      UNION
      SELECT user_id, 'asset_group' AS kind FROM bms.user_asset_group_access WHERE user_id = ANY(${ids}::uuid[])
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
