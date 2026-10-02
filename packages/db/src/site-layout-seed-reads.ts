import type pg from "pg";

import type { GroupMember } from "@bms/shared";

/**
 * The two reads the SMOC standard site layout's copy rule binds role tiles from: a group's members
 * by role, and the organization's active points. Shared by the seed's copy (`site-layout-seed.ts`)
 * and the upgrade chain's electrical step (`site-layout-seed-upgrade.ts`, `F3.74` ADR 0088
 * Amendment 2), which asks which tiles the copy would keep today. One module, so the two cannot
 * read the copy rule's inputs two ways; its own file, because the seed imports the upgrade.
 */

/** `ORDER BY a.code`: `planTemplateWidget`'s tie-break reads the code (ADR 0049 Amendment 2). */
const MEMBERS_SQL = `
  SELECT agm.role, a.id AS asset_id, a.code
    FROM bms.asset_group_members agm
    JOIN bms.assets a ON a.id = agm.asset_id
   WHERE agm.asset_group_id = $1 AND a.organization_id = $2
   ORDER BY a.code
`;
const ACTIVE_POINTS_SQL = `
  SELECT id, asset_id, point_key FROM bms.asset_points
   WHERE organization_id = $1 AND active = true
`;

/** Members of one group by role; a member with no role binds nothing. */
export async function membersByRole(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  groupId: string,
): Promise<Map<string, GroupMember[]>> {
  const res = await pool.query<{ role: string | null; asset_id: string; code: string }>(MEMBERS_SQL, [
    groupId,
    organizationId,
  ]);
  const byRole = new Map<string, GroupMember[]>();
  for (const row of res.rows) {
    if (!row.role) continue;
    const list = byRole.get(row.role) ?? [];
    list.push({ assetId: row.asset_id, code: row.code });
    byRole.set(row.role, list);
  }
  return byRole;
}

/** The organization's active points, `asset_id::point_key` → point id, as `planTemplateWidget` reads them. */
export async function activePointsByAsset(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
): Promise<Map<string, string>> {
  const res = await pool.query<{ id: string; asset_id: string; point_key: string }>(ACTIVE_POINTS_SQL, [
    organizationId,
  ]);
  return new Map(res.rows.map((row) => [`${row.asset_id}::${row.point_key}`, row.id] as const));
}
