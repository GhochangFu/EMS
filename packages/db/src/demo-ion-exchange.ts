import bcrypt from "bcrypt";
import type pg from "pg";

import { withOrganization } from "./seed-tenant";
import {
  DEMO_WATER_CLASSES,
  DEMO_WATER_FLOW_POINTS_SQL,
  DEMO_WATER_PIN_SQL,
  DEMO_WATER_TEMPLATE_POINT_TOTAL,
  DEMO_WATER_TEMPLATE_POINTS_SQL,
  DEMO_WATER_TEMPLATE_SQL,
  demoWaterTemplatePointsParams,
} from "./water-plant-demo-seed";
import {
  DEMO_MIMIC_ROLE_BY_ASSET_CODE,
  DEMO_MIMIC_WIDGET_CONFIG,
  DEMO_MIMIC_WIDGET_RESIZE_SQL,
} from "./water-mimic-demo-seed";

/**
 * `F3.32` / ADR 0079 Amendment 1 — the Ion Exchange demo organization, made by
 * a one-off command (`pnpm --filter @bms/db demo:ion-exchange`) and **not** by
 * `db:seed`. The owner ruled it on 2026-09-28 after the runbook found that no
 * route creates an asset group, a membership, a user or an access grant.
 *
 * **What it creates, in `IONX-DEMO` only.** One site, one simulator `WATER`
 * RTU at it, five water assets pinned to per-organization copies of the
 * `DEMO-WATER-<CLASS>` mirror templates (the same rows `water-plant-demo-seed.ts`
 * writes for ESKOM — templates are per organization, so ESKOM's do not carry
 * over), their flow catalog rows, the `demo-water-plant` group with the
 * `water_train` roles, a group-scoped dashboard with one `mimic` widget, and
 * the login `ionx-admin@bms.local` with organization access to `IONX-DEMO`
 * alone.
 *
 * **The asset codes end `-02`, not `-01` — and that is forced, not chosen.**
 * `bms.assets.code` is unique across the whole fleet (`assets_code_unique`,
 * migration `0000`), and `db:seed` already owns `WTR-WTP-01` … `WTR-ETP-01`
 * under ESKOM. `seedEskomAssets` also looks an asset up by code alone and
 * rewrites its `organization_id`, so a shared code would move back to ESKOM
 * on the next seed. `-02` keeps the `WTR-<CLASS>-NN` shape `apps/sim`'s
 * `waterClassOf` reads (it matches the `-<CLASS>-` infix, not the number).
 *
 * **Tenant context and roles.** The tenant rows run inside
 * `withOrganization(IONX-DEMO)` on a `max: 1` `bms_owner` pool, exactly as
 * `seed.ts` does, so `FORCE ROW LEVEL SECURITY` binds every write. The login
 * and its grant run on the superuser pool, outside any tenant bracket — the
 * `seedPheOrganizationAdmin` reason (`seed-tenant.ts`,
 * `resolveSeedSuperuserUrl`). `bms.organizations` carries no policy.
 *
 * **Idempotent, and says so.** Every write is insert-if-absent
 * (`ON CONFLICT DO NOTHING`, or a `WHERE` that matches nothing on a re-run),
 * so the sum of row counts is 0 on a second run. A membership role is written
 * only while it is NULL — an operator's change through the role picker is
 * never overwritten. The post-condition is a `SELECT` (a FORCE-RLS write can
 * drop rows without raising, so a row count proves nothing), and it throws
 * with the counts if anything is missing.
 *
 * **Prerequisite.** `roles → migrate → seed` has run: the flow keys are FKs
 * into the fleet-wide `bms.point_keys`, and the roles `wtp`/`ro`/`stp`/`etp`
 * come from migration `0087`.
 */

export const IONX_ORG_CODE = "IONX-DEMO";
export const IONX_ORG_NAME = "Ion Exchange Demo";
/** ISO 4217 — `bms.organizations.currency` is NOT NULL with no default (migration `0076`). */
export const IONX_ORG_CURRENCY = "INR";

export const IONX_SITE_NAME = "Ion Exchange Demo Plant";
/** Fleet-wide unique (`locations_slug_unique`). */
export const IONX_SITE_SLUG = "ionx-demo-plant";
export const IONX_SITE_CODE = "IONX-DEMO-PLANT";
/** The `bms.location_types` row a water site takes (migration `0085`). */
export const IONX_SITE_TYPE = "pump_station";
export const IONX_SITE_TIMEZONE = "Asia/Kolkata";
/** Mumbai. */
export const IONX_SITE_LATITUDE = 19.076;
export const IONX_SITE_LONGITUDE = 72.8777;
export const IONX_SITE_PROVINCE = "Maharashtra";

/** The simulator RTU, named the way `ensureEskomDomainRtus` names its `WATER` one. */
export const IONX_RTU_CODE = `SIM-RTU-${IONX_SITE_CODE}-WATER`;

export const IONX_GROUP_CODE = "demo-water-plant";
export const IONX_GROUP_NAME = "Demo water plant";
export const IONX_DASHBOARD_SLUG = "water-plant-mimic";
export const IONX_DASHBOARD_NAME = "Water plant mimic";
export const IONX_WIDGET_CONFIG = DEMO_MIMIC_WIDGET_CONFIG;

export const IONX_ADMIN_EMAIL = "ionx-admin@bms.local";
export const IONX_ADMIN_DISPLAY_NAME = "Ion Exchange Demo Admin";
export const IONX_ADMIN_ROLE = "organization_admin";
/** The realm's demo password convention (`phe-admin@bms.local`). Change it on a customer-facing host. */
export const IONX_ADMIN_DEMO_PASSWORD = "admin123";

/** `WTR-WTP-01` → `WTR-WTP-02`: the ESKOM code with the fleet-unique suffix (module docblock). */
export function ionxAssetCodeFor(eskomAssetCode: string): string {
  if (!eskomAssetCode.endsWith("-01")) {
    throw new Error(`ionxAssetCodeFor: '${eskomAssetCode}' does not end in -01`);
  }
  return `${eskomAssetCode.slice(0, -3)}-02`;
}

/** The five classes, re-coded for this organization. Entry `i` is `DEMO_WATER_CLASSES[i]`. */
export const IONX_WATER_CLASSES = DEMO_WATER_CLASSES.map((c) => ({
  ...c,
  assetCode: ionxAssetCodeFor(c.assetCode),
}));

export const IONX_ASSET_CODES: readonly string[] = IONX_WATER_CLASSES.map((c) => c.assetCode);
export const IONX_TEMPLATE_CODES: readonly string[] = IONX_WATER_CLASSES.map((c) => c.templateCode);

/** The `water_train` role per IONX asset code — the ESKOM demo group's map, re-keyed. */
export const IONX_ROLE_BY_ASSET_CODE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(DEMO_MIMIC_ROLE_BY_ASSET_CODE).map(([code, role]) => [ionxAssetCodeFor(code), role]),
);

const IONX_FLOW_PAIRS = IONX_WATER_CLASSES.flatMap((c) =>
  c.measuredFlowKeys.map((pointKey) => ({ assetCode: c.assetCode, pointKey })),
);

/** What the post-condition must read back. */
export const IONX_EXPECTED = {
  locations: 1,
  rtus: 1,
  assets: IONX_WATER_CLASSES.length,
  wired: IONX_WATER_CLASSES.length,
  pinned: IONX_WATER_CLASSES.length,
  templatePoints: DEMO_WATER_TEMPLATE_POINT_TOTAL,
  flowPoints: IONX_FLOW_PAIRS.length,
  groups: 1,
  roledMembers: IONX_WATER_CLASSES.length,
  dashboards: 1,
  widgets: 1,
} as const;

export type IonxTenantCounts = { [K in keyof typeof IONX_EXPECTED]: number };

export type IonxIdentityCounts = {
  /** The login exists, homed in `IONX-DEMO`, as an `organization_admin`. */
  users: number;
  /** Its `user_organization_access` rows naming `IONX-DEMO`. */
  orgGrants: number;
  /** Any grant naming another organization, a location or an asset group — must be 0. */
  otherGrants: number;
};

/**
 * The mismatches between a read-back and {@link IONX_EXPECTED}, as `name: got of want`.
 * `widgets` is a floor, not an exact count — an operator may add a second mimic widget to the
 * demo dashboard, and the command's post-condition must not fail because of it (review).
 */
export function ionxShortfalls(tenant: IonxTenantCounts, identity: IonxIdentityCounts): string[] {
  const out: string[] = [];
  for (const key of Object.keys(IONX_EXPECTED) as (keyof typeof IONX_EXPECTED)[]) {
    if (key === "widgets") {
      if (tenant.widgets < IONX_EXPECTED.widgets) {
        out.push(`widgets: ${tenant.widgets} of at least ${IONX_EXPECTED.widgets}`);
      }
      continue;
    }
    if (tenant[key] !== IONX_EXPECTED[key]) {
      out.push(`${key}: ${tenant[key]} of ${IONX_EXPECTED[key]}`);
    }
  }
  if (identity.users !== 1) out.push(`users: ${identity.users} of 1`);
  if (identity.orgGrants !== 1) out.push(`orgGrants: ${identity.orgGrants} of 1`);
  if (identity.otherGrants !== 0) out.push(`otherGrants: ${identity.otherGrants} of 0`);
  return out;
}

const ORG_INSERT_SQL = `
INSERT INTO bms.organizations (code, name, meta, currency, timezone)
VALUES ($1, $2, '{"tenant":"demo","createdBy":"demo:ion-exchange"}'::jsonb, $3, $4)
ON CONFLICT (code) DO NOTHING
`;

const ORG_ID_SQL = `SELECT id FROM bms.organizations WHERE code = $1`;

const LOCATION_INSERT_SQL = `
INSERT INTO bms.locations
  (organization_id, code, slug, name, type, province, latitude, longitude, timezone, active, meta)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, '{"createdBy":"demo:ion-exchange"}'::jsonb)
ON CONFLICT DO NOTHING
`;

const LOCATION_ID_SQL = `SELECT id FROM bms.locations WHERE organization_id = $1 AND slug = $2`;

const RTU_INSERT_SQL = `
INSERT INTO bms.rtus
  (organization_id, location_id, code, display_name, source_type, domain, ingest_enabled, meta)
VALUES ($1, $2, $3, $4, 'simulator', 'water', false, '{"synthetic":true}'::jsonb)
ON CONFLICT (location_id, code) DO NOTHING
`;

const RTU_ID_SQL = `SELECT id FROM bms.rtus WHERE location_id = $1 AND code = $2`;

/** `ON CONFLICT (code)`: a code another organization owns is left alone, and the read-back fails. */
const ASSET_INSERT_SQL = `
INSERT INTO bms.assets (organization_id, code, name, site_name, domain, location_id, rtu_id, meta)
VALUES ($1, $2, $3, $4, 'water', $5, $6, '{"telemetrySource":"simulator"}'::jsonb)
ON CONFLICT (code) DO NOTHING
`;

/**
 * `F3.73` plan D12 — the group carries the `water` domain, so a site-layout copy at the demo
 * plant binds its `water` tab. An existing row gains the domain only while it has none, so a
 * re-run still writes 0 rows and an administrator's re-filing stands.
 */
export const IONX_GROUP_UPSERT_SQL = `
INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id, domain)
VALUES ($1, $2, $3, $4, $5, 'water')
ON CONFLICT (location_id, code) DO UPDATE SET domain = EXCLUDED.domain
WHERE bms.asset_groups.domain IS NULL
`;

const GROUP_ID_SQL = `SELECT id FROM bms.asset_groups WHERE location_id = $1 AND code = $2`;

/** The role is written only while it is NULL, so a re-run is 0 rows and an operator's role stands. */
const MEMBER_UPSERT_SQL = `
INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role)
SELECT $1, a.id, $3
FROM bms.assets a
WHERE a.organization_id = $2 AND a.code = $4
ON CONFLICT (asset_group_id, asset_id) DO UPDATE
SET role = EXCLUDED.role
WHERE bms.asset_group_members.role IS NULL
`;

const DASHBOARD_INSERT_SQL = `
INSERT INTO bms.dashboards (organization_id, slug, name, asset_group_id)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, slug) DO NOTHING
`;

const DASHBOARD_ID_SQL = `SELECT id FROM bms.dashboards WHERE organization_id = $1 AND slug = $2`;

const WIDGET_INSERT_SQL = `
INSERT INTO bms.dashboard_widgets
  (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
SELECT $1, $2, 'mimic', 0, 0, 12, 10, $3::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM bms.dashboard_widgets WHERE dashboard_id = $2 AND widget_type = 'mimic'
)
`;

/**
 * The tenant post-condition. Params: `[org, slug, rtuCode, assetCodes,
 * templateCodes, flowAssetCodes, flowPointKeys, groupCode, dashboardSlug]`.
 * `$4` and `$5` are zipped by position for the pin count, as in
 * `DEMO_WATER_VERIFY_SQL`.
 */
const TENANT_VERIFY_SQL = `
SELECT
  (SELECT count(*)::int FROM bms.locations WHERE organization_id = $1 AND slug = $2) AS locations,
  (SELECT count(*)::int FROM bms.rtus r JOIN bms.locations l ON l.id = r.location_id
     WHERE r.organization_id = $1 AND l.slug = $2 AND r.code = $3 AND r.domain = 'water'
       AND r.source_type = 'simulator') AS rtus,
  (SELECT count(*)::int FROM bms.assets a JOIN bms.locations l ON l.id = a.location_id
     WHERE a.organization_id = $1 AND l.slug = $2 AND a.code = ANY($4::varchar[])
       AND a.domain = 'water') AS assets,
  (SELECT count(*)::int FROM bms.assets a JOIN bms.rtus r ON r.id = a.rtu_id
     WHERE a.organization_id = $1 AND a.code = ANY($4::varchar[]) AND r.code = $3
       AND a.meta->>'telemetrySource' = 'simulator') AS wired,
  (SELECT count(*)::int FROM unnest($4::varchar[], $5::varchar[]) AS p(asset_code, template_code)
     WHERE EXISTS (
       SELECT 1 FROM bms.assets a JOIN bms.asset_templates t ON t.id = a.template_id
       WHERE a.organization_id = $1 AND a.code = p.asset_code AND t.code = p.template_code
     )) AS pinned,
  (SELECT count(*)::int FROM bms.template_points tp
     JOIN bms.asset_templates t ON t.id = tp.template_id
     WHERE t.organization_id = $1 AND t.code = ANY($5::varchar[]) AND t.version = 1) AS "templatePoints",
  (SELECT count(*)::int FROM unnest($6::varchar[], $7::varchar[]) AS e(asset_code, point_key)
     WHERE EXISTS (
       SELECT 1 FROM bms.asset_points ap JOIN bms.assets a ON a.id = ap.asset_id
       WHERE a.organization_id = $1 AND a.code = e.asset_code AND ap.point_key = e.point_key
     )) AS "flowPoints",
  (SELECT count(*)::int FROM bms.asset_groups ag JOIN bms.locations l ON l.id = ag.location_id
     WHERE ag.organization_id = $1 AND l.slug = $2 AND ag.code = $8) AS groups,
  (SELECT count(*)::int FROM bms.asset_group_members agm
     JOIN bms.asset_groups ag ON ag.id = agm.asset_group_id
     JOIN bms.assets a ON a.id = agm.asset_id
     WHERE ag.organization_id = $1 AND ag.code = $8 AND a.code = ANY($4::varchar[])
       AND agm.role IS NOT NULL) AS "roledMembers",
  (SELECT count(*)::int FROM bms.dashboards d JOIN bms.asset_groups ag ON ag.id = d.asset_group_id
     WHERE d.organization_id = $1 AND d.slug = $9 AND ag.code = $8) AS dashboards,
  (SELECT count(*)::int FROM bms.dashboard_widgets w JOIN bms.dashboards d ON d.id = w.dashboard_id
     WHERE d.organization_id = $1 AND d.slug = $9 AND w.widget_type = 'mimic') AS widgets
`;

/** The identity post-condition, on the superuser pool. Params: `[email, orgId, role]`. */
const IDENTITY_VERIFY_SQL = `
SELECT
  (SELECT count(*)::int FROM bms.users
     WHERE email = $1 AND organization_id = $2 AND role = $3) AS users,
  (SELECT count(*)::int FROM bms.user_organization_access uoa JOIN bms.users u ON u.id = uoa.user_id
     WHERE u.email = $1 AND uoa.organization_id = $2) AS "orgGrants",
  (SELECT count(*)::int FROM bms.user_organization_access uoa JOIN bms.users u ON u.id = uoa.user_id
     WHERE u.email = $1 AND uoa.organization_id <> $2)
  + (SELECT count(*)::int FROM bms.user_location_access ula JOIN bms.users u ON u.id = ula.user_id
     WHERE u.email = $1)
  + (SELECT count(*)::int FROM bms.user_asset_group_access uaga JOIN bms.users u ON u.id = uaga.user_id
     WHERE u.email = $1) AS "otherGrants"
`;

/** Insert-if-absent. An existing row with another home or role is left alone — the post-condition names it. */
const USER_INSERT_SQL = `
INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (email) DO NOTHING
`;

/**
 * Security review (Low): the `WHERE` names the exact row `USER_INSERT_SQL` just
 * inserted-or-left-alone — organization AND role, not `email` alone. Without
 * both, a pre-existing `ionx-admin@bms.local` homed in a DIFFERENT organization
 * (or a different role in this one) would still match on email and be granted
 * `IONX-DEMO` access it was never meant to have.
 */
const USER_ORG_GRANT_SQL = `
INSERT INTO bms.user_organization_access (user_id, organization_id)
SELECT u.id, $2 FROM bms.users u
WHERE u.email = $1 AND u.organization_id = $2 AND u.role = $3
  AND NOT EXISTS (
    SELECT 1 FROM bms.user_organization_access uoa
    WHERE uoa.user_id = u.id AND uoa.organization_id = $2
  )
`;

async function count(pool: pg.Pool, sql: string, values: unknown[]): Promise<number> {
  const res = await pool.query(sql, values);
  return res.rowCount ?? 0;
}

async function oneId(pool: pg.Pool, sql: string, values: unknown[], what: string): Promise<string> {
  const res = await pool.query<{ id: string }>(sql, values);
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error(`demo:ion-exchange: ${what} does not exist after its insert-if-absent`);
  }
  return id;
}

export type IonxDemoResult = {
  organizationId: string;
  /** Rows written by this run — 0 on every run after the first. */
  written: number;
  tenant: IonxTenantCounts;
  identity: IonxIdentityCounts;
};

/**
 * Builds (or re-checks) the Ion Exchange demo organization. `pool` must be the
 * `max: 1` `bms_owner` pool (`createSeedPool`); `superuserPool` the identity
 * connection (`resolveSeedSuperuserUrl`). Throws with the read-back counts if
 * the post-condition fails.
 */
export async function runIonExchangeDemo(pool: pg.Pool, superuserPool: pg.Pool): Promise<IonxDemoResult> {
  let written = 0;

  // Pre-tenant: `bms.organizations` carries no policy.
  written += await count(pool, ORG_INSERT_SQL, [IONX_ORG_CODE, IONX_ORG_NAME, IONX_ORG_CURRENCY, IONX_SITE_TIMEZONE]);
  const organizationId = await oneId(pool, ORG_ID_SQL, [IONX_ORG_CODE], `organization ${IONX_ORG_CODE}`);

  const tenant = await withOrganization(pool, organizationId, async () => {
    written += await count(pool, LOCATION_INSERT_SQL, [
      organizationId,
      IONX_SITE_CODE,
      IONX_SITE_SLUG,
      IONX_SITE_NAME,
      IONX_SITE_TYPE,
      IONX_SITE_PROVINCE,
      IONX_SITE_LATITUDE,
      IONX_SITE_LONGITUDE,
      IONX_SITE_TIMEZONE,
    ]);
    const locationId = await oneId(
      pool,
      LOCATION_ID_SQL,
      [organizationId, IONX_SITE_SLUG],
      `site '${IONX_SITE_SLUG}' in ${IONX_ORG_CODE} (is the slug taken by another organization?)`,
    );

    written += await count(pool, RTU_INSERT_SQL, [
      organizationId,
      locationId,
      IONX_RTU_CODE,
      `${IONX_SITE_NAME} WATER Simulator`,
    ]);
    const rtuId = await oneId(pool, RTU_ID_SQL, [locationId, IONX_RTU_CODE], `RTU ${IONX_RTU_CODE}`);

    for (const c of IONX_WATER_CLASSES) {
      written += await count(pool, ASSET_INSERT_SQL, [
        organizationId,
        c.assetCode,
        c.assetName,
        IONX_SITE_NAME,
        locationId,
        rtuId,
      ]);
      written += await count(pool, DEMO_WATER_TEMPLATE_SQL, [
        organizationId,
        c.templateCode,
        c.templateName,
        c.assetType,
      ]);
      written += await count(pool, DEMO_WATER_TEMPLATE_POINTS_SQL, demoWaterTemplatePointsParams(organizationId, c));
      written += await count(pool, DEMO_WATER_FLOW_POINTS_SQL, [organizationId, c.assetCode, c.measuredFlowKeys]);
      written += await count(pool, DEMO_WATER_PIN_SQL, [organizationId, c.assetCode, c.role, c.templateCode]);
    }

    written += await count(pool, IONX_GROUP_UPSERT_SQL, [
      locationId,
      IONX_GROUP_CODE,
      IONX_GROUP_NAME,
      "The Ion Exchange demo plant's water train, for the F3.32 mimic (ADR 0079 Amendment 1).",
      organizationId,
    ]);
    const groupId = await oneId(pool, GROUP_ID_SQL, [locationId, IONX_GROUP_CODE], `group ${IONX_GROUP_CODE}`);
    for (const [assetCode, roleCode] of Object.entries(IONX_ROLE_BY_ASSET_CODE)) {
      written += await count(pool, MEMBER_UPSERT_SQL, [groupId, organizationId, roleCode, assetCode]);
    }

    written += await count(pool, DASHBOARD_INSERT_SQL, [
      organizationId,
      IONX_DASHBOARD_SLUG,
      IONX_DASHBOARD_NAME,
      groupId,
    ]);
    const dashboardId = await oneId(
      pool,
      DASHBOARD_ID_SQL,
      [organizationId, IONX_DASHBOARD_SLUG],
      `dashboard ${IONX_DASHBOARD_SLUG}`,
    );
    written += await count(pool, WIDGET_INSERT_SQL, [organizationId, dashboardId, JSON.stringify(IONX_WIDGET_CONFIG)]);
    // `F3.32b`: a widget an earlier run wrote at 12 × 6 becomes 10 tall; any other size is left.
    written += await count(pool, DEMO_MIMIC_WIDGET_RESIZE_SQL, [organizationId, dashboardId]);

    const res = await pool.query<IonxTenantCounts>(TENANT_VERIFY_SQL, [
      organizationId,
      IONX_SITE_SLUG,
      IONX_RTU_CODE,
      IONX_ASSET_CODES,
      IONX_TEMPLATE_CODES,
      IONX_FLOW_PAIRS.map((p) => p.assetCode),
      IONX_FLOW_PAIRS.map((p) => p.pointKey),
      IONX_GROUP_CODE,
      IONX_DASHBOARD_SLUG,
    ]);
    const row = res.rows[0];
    if (!row) {
      throw new Error("demo:ion-exchange: the tenant read-back returned no row");
    }
    return row;
  });

  // Identity: superuser, outside any tenant bracket (module docblock).
  const passwordHash = await bcrypt.hash(IONX_ADMIN_DEMO_PASSWORD, 10);
  written += await count(superuserPool, USER_INSERT_SQL, [
    IONX_ADMIN_EMAIL,
    passwordHash,
    IONX_ADMIN_DISPLAY_NAME,
    IONX_ADMIN_ROLE,
    organizationId,
  ]);
  written += await count(superuserPool, USER_ORG_GRANT_SQL, [
    IONX_ADMIN_EMAIL,
    organizationId,
    IONX_ADMIN_ROLE,
  ]);
  const idRes = await superuserPool.query<IonxIdentityCounts>(IDENTITY_VERIFY_SQL, [
    IONX_ADMIN_EMAIL,
    organizationId,
    IONX_ADMIN_ROLE,
  ]);
  const identity = idRes.rows[0] ?? { users: -1, orgGrants: -1, otherGrants: -1 };

  const shortfalls = ionxShortfalls(tenant, identity);
  if (shortfalls.length > 0) {
    throw new Error(
      `demo:ion-exchange: the post-condition failed — ${shortfalls.join(", ")}. ` +
        "Each count is read back, not inferred from the statements completing. A code or slug " +
        "another organization owns is left alone by the insert-if-absent and shows up here.",
    );
  }
  return { organizationId, written, tenant, identity };
}
