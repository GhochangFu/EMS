import type pg from "pg";

/**
 * Location backfill and derived asset groups, split out of `seed.ts` to keep it
 * under the AGENTS.md §4.5 1000-line cap. Pure move — the statements and their
 * order are unchanged, and `assignEskomAssetRtus` still runs between the two
 * exported functions exactly as before.
 */

/** Points every asset at the location whose name matches its site name. */
export async function backfillAssetLocations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    UPDATE bms.assets AS a
    SET location_id = l.id
    FROM bms.locations AS l
    WHERE a.site_name = l.name
      AND (a.location_id IS NULL OR a.location_id <> l.id)
  `);
}

/**
 * Derives one asset group per domain per location and re-points membership.
 * Runs after the location backfill so a moved asset leaves its old group first.
 *
 * **`E7.1b` / ADR 0043 decisions 5 + 6.** `0047` gives `bms.asset_groups` a
 * NOT-NULL `organization_id` with `tenant_isolation` + `FORCE`, and the
 * `asset_group_members` junction a policy keyed on both parents' org. This ran
 * once across every organization before; it now runs once *per* organization,
 * inside that org's `withOrganization` context (`seed.ts`), so the `assets` read
 * returns only this org's rows and the group/member writes satisfy the policy.
 * `organizationId` is stamped on every group and equals the current context —
 * safe because a group is derived per `(domain, location)` and a location
 * belongs to exactly one org, so the group's org is its location's org.
 */
export async function seedAssetGroups(
  pool: pg.Pool,
  organizationId: string,
): Promise<void> {
  await pool.query(`
    DELETE FROM bms.asset_group_members AS agm
    USING bms.asset_groups AS ag,
          bms.assets AS a
    WHERE agm.asset_group_id = ag.id
      AND agm.asset_id = a.id
      AND a.location_id IS NOT NULL
      AND ag.location_id <> a.location_id
  `);

  const assetScopeRows = await pool.query<{
    asset_id: string;
    code: string;
    domain: string;
    location_id: string;
  }>(`
    SELECT id AS asset_id, code, domain, location_id
    FROM bms.assets
    WHERE location_id IS NOT NULL
    ORDER BY site_name, code
  `);

  for (const row of assetScopeRows.rows) {
    const groupCode =
      row.domain === "hvac"
        ? "hvac"
        : row.domain === "it"
          ? "it-rack"
          : row.domain === "environment"
            ? "environment"
            : row.code.includes("UPS") || row.code.includes("BATT")
              ? "ups-battery"
              : "electrical";
    const groupName =
      groupCode === "it-rack"
        ? "IT & Rack Load"
        : groupCode === "ups-battery"
          ? "UPS & Battery"
          : groupCode[0]!.toUpperCase() + groupCode.slice(1);
    const group = await pool.query<{ id: string }>(
      `
      INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (location_id, code) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          organization_id = EXCLUDED.organization_id
      RETURNING id
      `,
      [
        row.location_id,
        groupCode,
        groupName,
        "Seeded operational asset group for scoped access demos.",
        organizationId,
      ],
    );
    const groupId = group.rows[0]?.id;
    if (!groupId) {
      continue;
    }
    await pool.query(
      `
      INSERT INTO bms.asset_group_members (asset_group_id, asset_id)
      VALUES ($1, $2)
      ON CONFLICT (asset_group_id, asset_id) DO NOTHING
      `,
      [groupId, row.asset_id],
    );
  }
}
