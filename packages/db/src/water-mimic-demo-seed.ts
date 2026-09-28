import type pg from "pg";

import { DEMO_WATER_ASSET_CODES, DEMO_WATER_SITE_NAME } from "./water-plant-demo-seed";

/**
 * `F3.32` v1 / ADR 0079 decision 5, Q3 ruling — the demo asset group and
 * dashboard the `water_train` mimic preset resolves on.
 *
 * **What this seeds.** One asset group `demo-water-plant` ("Demo water
 * plant") at {@link DEMO_WATER_SITE_NAME}, holding the same five `WTR-`
 * assets `water-plant-demo-seed.ts` seeds, each carrying the `bms.asset_roles`
 * code its class fills in the preset (migration `0087`: `wtp`, `ro`, `stp`,
 * `etp`; the cooling tower reuses `utilities`, migration `0051`). One
 * dashboard, slug `demo-water-plant-mimic`, scoped to that group, holding one
 * `mimic` widget configured `{ source: "preset", preset: "water_train" }`.
 * The intake, softener and storage nodes have no member, so the demo shows
 * them "Not assigned" (ADR 0079 Open point 1) — that is the intended state,
 * not a gap.
 *
 * **A second group, not `water` (measured fact, plan §1).** `seedAssetGroups`
 * already files these five assets under the site's `water` group
 * (`asset-groups-seed.ts`, `demoGroupCodesForAsset`), which
 * `verify-hierarchy-seed.ts:206` counts. `demo-water-plant` is a distinct
 * `(location_id, code)` row, so it does not touch that count.
 *
 * **Membership role write follows the `seedAssetGroups` idiom exactly**:
 * `COALESCE(bms.asset_group_members.role, EXCLUDED.role)` — a re-seed never
 * overwrites a role an operator changed through `F3.37`'s picker, and never
 * reverts one this seed itself already wrote on a prior boot.
 *
 * **Where it runs (`seed.ts`).** After `seedWaterPlantDemo`, whose five
 * `WTR-` assets and their `location_id` (via `backfillAssetLocations`) this
 * module reads. Also after `seedAssetGroups`, which must have already created
 * the site's `water` group and the location backfill — this module does not
 * repeat either.
 *
 * **Tenant context.** Called inside the ESKOM `withOrganization` bracket, the
 * same as `seedWaterPlantDemo` — every statement runs with
 * `app.current_organization` set, and the post-condition is a `SELECT`,
 * never a `rowCount`, for the FORCE-RLS reason that module's docblock states:
 * a write outside the tenant context changes zero rows without raising.
 *
 * **Idempotent under `compose up`.** The group upsert is `ON CONFLICT
 * (location_id, code) DO UPDATE` on name/description only (never on role);
 * the dashboard and widget inserts are `ON CONFLICT DO NOTHING` /
 * `NOT EXISTS`-guarded, so a re-seed never duplicates either.
 */

/** The demo group's code — a second, distinct group from `seedAssetGroups`'s `water`. */
export const DEMO_MIMIC_GROUP_CODE = "demo-water-plant";

/** The demo group's display name. */
export const DEMO_MIMIC_GROUP_NAME = "Demo water plant";

/** The demo dashboard's slug, unique per `(organization_id, slug)` (migration `0050`). */
export const DEMO_MIMIC_DASHBOARD_SLUG = "demo-water-plant-mimic";

/** The demo dashboard's display name. */
export const DEMO_MIMIC_DASHBOARD_NAME = "Demo water plant";

/**
 * The widget's config, spelled here as a literal rather than built through
 * `packages/shared`'s `mimicConfigSchema` (U0) — `packages/db` writes raw SQL
 * and does not need the runtime validator to construct a value it already
 * knows is shaped correctly; `water-mimic-demo-seed.spec.ts` is what proves it
 * parses under that schema.
 */
export const DEMO_MIMIC_WIDGET_CONFIG = {
  source: "preset",
  preset: "water_train",
} as const;

/**
 * The five demo asset codes, each mapped to the `bms.asset_roles` code its
 * class fills in the `water_train` preset (ADR 0079 decision 5). Keys equal
 * {@link DEMO_WATER_ASSET_CODES} exactly — `water-mimic-demo-seed.spec.ts`
 * holds both directions, so dropping `WTR-CT-01` (say) fails loudly rather
 * than silently seeding four memberships.
 */
export const DEMO_MIMIC_ROLE_BY_ASSET_CODE: Readonly<Record<string, string>> = {
  "WTR-WTP-01": "wtp",
  "WTR-RO-01": "ro",
  "WTR-CT-01": "utilities",
  "WTR-STP-01": "stp",
  "WTR-ETP-01": "etp",
};

/** The site's location id, by name, inside the current tenant context. */
const LOCATION_ID_SQL = `
  SELECT id FROM bms.locations
  WHERE organization_id = $1 AND name = $2
`;

/** The group upsert — name/description only, per the module docblock. */
const GROUP_UPSERT_SQL = `
  INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (location_id, code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      organization_id = EXCLUDED.organization_id
  RETURNING id
`;

/**
 * The membership upsert for one asset, by code. `COALESCE` on the existing
 * role — the `seedAssetGroups` idiom this module's docblock names.
 */
const MEMBER_UPSERT_SQL = `
  INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role)
  SELECT $1, a.id, $3
  FROM bms.assets a
  WHERE a.organization_id = $2 AND a.code = $4
  ON CONFLICT (asset_group_id, asset_id) DO UPDATE
  SET role = COALESCE(bms.asset_group_members.role, EXCLUDED.role)
`;

/** The demo dashboard, scoped to the group. `DO NOTHING`: `slug` is stable. */
const DASHBOARD_UPSERT_SQL = `
  INSERT INTO bms.dashboards (organization_id, slug, name, asset_group_id)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (organization_id, slug) DO NOTHING
  RETURNING id
`;

/** The dashboard, if it already existed on a re-seed (the upsert above then returns no row). */
const DASHBOARD_ID_SQL = `
  SELECT id FROM bms.dashboards WHERE organization_id = $1 AND slug = $2
`;

/** One mimic widget per dashboard — `NOT EXISTS`-guarded so a re-seed writes it once. */
const WIDGET_INSERT_SQL = `
  INSERT INTO bms.dashboard_widgets
    (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
  SELECT $1, $2, 'mimic', 0, 0, 12, 10, $3::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM bms.dashboard_widgets
    WHERE dashboard_id = $2 AND widget_type = 'mimic'
  )
`;

/**
 * The post-condition, read back inside the same tenant bracket: the group
 * exists, how many of the five demo assets carry a role, the dashboard
 * exists, and the mimic widget exists. Read back rather than inferred from
 * statement completion — `water-plant-demo-seed.ts`'s docblock states why: a
 * FORCE-RLS write can drop rows without raising.
 */
const VERIFY_SQL = `
SELECT
  (SELECT count(*)::int FROM bms.asset_groups
     WHERE organization_id = $1 AND code = $2) AS groups,
  (SELECT count(*)::int FROM bms.asset_group_members agm
     JOIN bms.asset_groups ag ON ag.id = agm.asset_group_id
     JOIN bms.assets a ON a.id = agm.asset_id
     WHERE ag.organization_id = $1 AND ag.code = $2
       AND a.code = ANY($3::varchar[])
       AND agm.role IS NOT NULL) AS roled,
  (SELECT count(*)::int FROM bms.dashboards
     WHERE organization_id = $1 AND slug = $4) AS dashboards,
  (SELECT count(*)::int FROM bms.dashboard_widgets w
     JOIN bms.dashboards d ON d.id = w.dashboard_id
     WHERE d.organization_id = $1 AND d.slug = $4 AND w.widget_type = 'mimic') AS widgets
`;

type VerifyRow = { groups: number; roled: number; dashboards: number; widgets: number };

export async function seedWaterMimicDemo(pool: pg.Pool, organizationId: string): Promise<void> {
  const loc = await pool.query<{ id: string }>(LOCATION_ID_SQL, [organizationId, DEMO_WATER_SITE_NAME]);
  const locationId = loc.rows[0]?.id;
  if (!locationId) {
    throw new Error(
      `seedWaterMimicDemo: no location named '${DEMO_WATER_SITE_NAME}' in this organization — ` +
        "must run after backfillAssetLocations/seedWaterPlantDemo.",
    );
  }

  const group = await pool.query<{ id: string }>(GROUP_UPSERT_SQL, [
    locationId,
    DEMO_MIMIC_GROUP_CODE,
    DEMO_MIMIC_GROUP_NAME,
    "Seeded group scoped to the F3.32 mimic demo dashboard (ADR 0079 decision 5).",
    organizationId,
  ]);
  const groupId = group.rows[0]?.id;
  if (!groupId) {
    throw new Error(`seedWaterMimicDemo: upsert of group '${DEMO_MIMIC_GROUP_CODE}' returned no id`);
  }

  for (const [assetCode, roleCode] of Object.entries(DEMO_MIMIC_ROLE_BY_ASSET_CODE)) {
    await pool.query(MEMBER_UPSERT_SQL, [groupId, organizationId, roleCode, assetCode]);
  }

  await pool.query(DASHBOARD_UPSERT_SQL, [
    organizationId,
    DEMO_MIMIC_DASHBOARD_SLUG,
    DEMO_MIMIC_DASHBOARD_NAME,
    groupId,
  ]);
  const dashboard = await pool.query<{ id: string }>(DASHBOARD_ID_SQL, [
    organizationId,
    DEMO_MIMIC_DASHBOARD_SLUG,
  ]);
  const dashboardId = dashboard.rows[0]?.id;
  if (!dashboardId) {
    throw new Error(`seedWaterMimicDemo: dashboard '${DEMO_MIMIC_DASHBOARD_SLUG}' does not exist after upsert`);
  }

  await pool.query(WIDGET_INSERT_SQL, [organizationId, dashboardId, JSON.stringify(DEMO_MIMIC_WIDGET_CONFIG)]);

  const check = await pool.query<VerifyRow>(VERIFY_SQL, [
    organizationId,
    DEMO_MIMIC_GROUP_CODE,
    DEMO_WATER_ASSET_CODES,
    DEMO_MIMIC_DASHBOARD_SLUG,
  ]);
  const row = check.rows[0];
  const groups = row?.groups ?? -1;
  const roled = row?.roled ?? -1;
  const dashboards = row?.dashboards ?? -1;
  const widgets = row?.widgets ?? -1;
  const wantRoled = Object.keys(DEMO_MIMIC_ROLE_BY_ASSET_CODE).length;
  // `widgets`: at least 1, not exactly 1 — an operator may add a second mimic widget to the demo
  // dashboard, and the boot must not fail because of it (review).
  if (groups !== 1 || roled !== wantRoled || dashboards !== 1 || widgets < 1) {
    throw new Error(
      `seedWaterMimicDemo: ${groups} of 1 demo group, ${roled} of ${wantRoled} demo assets roled, ` +
        `${dashboards} of 1 demo dashboard, ${widgets} mimic widget(s) (want at least 1). A FORCE-RLS ` +
        "write can drop rows without raising, so each is read back rather than inferred from the " +
        "statements completing. Check this runs inside the ESKOM tenant bracket, after seedAssetGroups " +
        "and seedWaterPlantDemo.",
    );
  }
}
