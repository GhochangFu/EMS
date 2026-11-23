import { mimicConfigSchema } from "@bms/shared";
import { expect } from "vitest";

import {
  IONX_ORG_CODE,
  IONX_ASSET_CODES,
  IONX_EXPECTED,
  IONX_GROUP_UPSERT_SQL,
  IONX_ROLE_BY_ASSET_CODE,
  IONX_SITE_TIMEZONE,
  IONX_WIDGET_CONFIG,
  IONX_ADMIN_DISPLAY_NAME,
  IONX_ADMIN_EMAIL,
  IONX_GROUP_CODE,
  IONX_GROUP_DESCRIPTION,
  IONX_NAMES_BEFORE_RENAME,
  IONX_ORG_NAME,
  IONX_RENAME_ADMIN_SQL,
  IONX_RENAME_ASSET_SITE_SQL,
  IONX_RENAME_GROUP_SQL,
  IONX_RENAME_ORG_SQL,
  IONX_RENAME_RTU_SQL,
  IONX_RENAME_SITE_SQL,
  IONX_RTU_CODE,
  IONX_RTU_DISPLAY_NAME,
  IONX_SITE_NAME,
  IONX_SITE_SLUG,
  ionxAssetCodeFor,
  runWaterDemo,
  ionxShortfalls,
  type IonxIdentityCounts,
  type IonxTenantCounts,
} from "./demo-water";
import { SEED_ORGANIZATION_CODES } from "./hierarchy-seed";
import { DEMO_WATER_ASSET_CODES } from "./water-plant-demo-seed";
import { DEMO_MIMIC_WIDGET_RESIZE_SQL } from "./water-mimic-demo-seed";
import { recordingSeedPool } from "./water-mimic-demo-seed.spec";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/** `assets_code_unique` is fleet-wide: no IONX code may equal an ESKOM demo code. */
export function assertNoIonxCodeCollidesWithTheEskomDemoPlant(): void {
  const eskom = new Set(DEMO_WATER_ASSET_CODES);
  const clashes = IONX_ASSET_CODES.filter((code) => eskom.has(code));
  expect(clashes).toEqual([]);
}

/** Each code keeps `WTR-<CLASS>-NN`, which `apps/sim`'s `waterClassOf` reads by infix. */
export function assertEachCodeKeepsTheSimulatorWaterShape(): void {
  expect([...IONX_ASSET_CODES]).toEqual(["WTR-WTP-02", "WTR-RO-02", "WTR-CT-02", "WTR-STP-02", "WTR-ETP-02"]);
}

/** A code that does not end in -01 is refused, not silently re-suffixed. */
export function assertIonxAssetCodeForRefusesAnUnexpectedSuffix(): void {
  expect(() => ionxAssetCodeFor("WTR-WTP-07")).toThrow(/does not end in -01/);
}

/** The role map is keyed by exactly the five IONX codes and carries the ruled roles. */
export function assertRoleMapIsTheRuledOne(): void {
  expect({ ...IONX_ROLE_BY_ASSET_CODE }).toEqual({
    "WTR-WTP-02": "wtp",
    "WTR-RO-02": "ro",
    "WTR-CT-02": "utilities",
    "WTR-STP-02": "stp",
    "WTR-ETP-02": "etp",
  });
}

/** The widget config parses under `mimicConfigSchema` (U0). */
export function assertTheWidgetConfigParsesUnderMimicConfigSchema(): void {
  const result = mimicConfigSchema.safeParse(IONX_WIDGET_CONFIG);
  expect(result.success, JSON.stringify(result)).toBe(true);
}

/** The widget config names the water train preset, as ruled. */
export function assertTheWidgetConfigIsTheWaterTrainPreset(): void {
  expect(IONX_WIDGET_CONFIG).toEqual({ source: "preset", preset: "water_train" });
}

const COMPLETE_IDENTITY: IonxIdentityCounts = { users: 1, orgGrants: 1, otherGrants: 0 };

/** A read-back equal to the expectation has no shortfall. */
export function assertAFullReadBackHasNoShortfall(): void {
  expect(ionxShortfalls({ ...IONX_EXPECTED }, COMPLETE_IDENTITY)).toEqual([]);
}

/** One missing roled member is named with its counts. */
export function assertAMissingRoledMemberIsNamed(): void {
  const tenant: IonxTenantCounts = { ...IONX_EXPECTED, roledMembers: 4 };
  expect(ionxShortfalls(tenant, COMPLETE_IDENTITY)).toEqual(["roledMembers: 4 of 5"]);
}

/** A grant beyond the one organization is a shortfall — the login must see IONX-DEMO only. */
export function assertAnExtraGrantIsAShortfall(): void {
  expect(ionxShortfalls({ ...IONX_EXPECTED }, { ...COMPLETE_IDENTITY, otherGrants: 1 })).toEqual([
    "otherGrants: 1 of 0",
  ]);
}

/**
 * `widgets` is a floor, not an exact count (review) — an operator-added second mimic widget must
 * not fail the post-condition.
 */
export function assertAnExtraWidgetIsNotAShortfall(): void {
  const tenant: IonxTenantCounts = { ...IONX_EXPECTED, widgets: 2 };
  expect(ionxShortfalls(tenant, COMPLETE_IDENTITY)).toEqual([]);
}

/** Fewer widgets than the floor is still a shortfall, named "at least". */
export function assertFewerWidgetsThanTheFloorIsAShortfall(): void {
  const tenant: IonxTenantCounts = { ...IONX_EXPECTED, widgets: 0 };
  expect(ionxShortfalls(tenant, COMPLETE_IDENTITY)).toEqual(["widgets: 0 of at least 1"]);
}

/**
 * ADR 0079 Amendment 1 depends on `F4.169` (ADR 0080 decision 1): the boot gate counts only
 * the seed's own organizations, so a third one does not stop `compose up`. The import of
 * `SEED_ORGANIZATION_CODES` is the compile-time half — the command cannot build against a
 * `main` without F4.169 — and this is the runtime half: IONX-DEMO is not a seed organization,
 * so the gate never counts it.
 */
export function assertIonxIsNotASeedOrganization(): void {
  expect(SEED_ORGANIZATION_CODES.length).toBeGreaterThan(0);
  expect(SEED_ORGANIZATION_CODES).not.toContain(IONX_ORG_CODE);
}

/**
 * `F3.32b` — the command runs the shared resize once, for IONX-DEMO's own dashboard. The fake
 * pool stops the run at the resize (so the identity half and its bcrypt never run) and the
 * tenant bracket rolls back.
 */
export async function assertTheCommandResizesItsOwnDashboardsWidget(): Promise<void> {
  const { pool, calls } = recordingSeedPool({ organization: "org-id", dashboard: "dashboard-id", other: "other-id" });
  const stop = new Error("stop at the resize");
  const recording = pool.query.bind(pool) as (sql: string, values?: unknown[]) => Promise<unknown>;
  (pool as unknown as { query: unknown }).query = async (sql: string, values?: unknown[]) => {
    const result = await recording(sql, values);
    if (sql === DEMO_MIMIC_WIDGET_RESIZE_SQL) {
      throw stop;
    }
    return result;
  };
  await expect(runWaterDemo(pool, pool)).rejects.toBe(stop);
  const resizes = calls.filter((c) => c.sql === DEMO_MIMIC_WIDGET_RESIZE_SQL);
  expect(resizes.map((c) => c.values)).toEqual([["org-id", "dashboard-id"]]);
}

/**
 * `F3.85` PR 6 / ADR 0099 A2 — the organization insert binds the zone its sites use, so a change
 * to `IONX_SITE_TIMEZONE` moves the organization's day boundary with them. The run stops at the
 * organization id read, after the insert.
 */
export async function assertTheOrganizationInsertBindsTheSiteTimezone(): Promise<void> {
  const { pool, calls } = recordingSeedPool({ organization: "org-id", dashboard: "dashboard-id", other: "other-id" });
  const stop = new Error("stop after the organization insert");
  const recording = pool.query.bind(pool) as (sql: string, values?: unknown[]) => Promise<unknown>;
  (pool as unknown as { query: unknown }).query = async (sql: string, values?: unknown[]) => {
    const result = await recording(sql, values);
    if (/INSERT INTO bms.organizations/.test(sql)) {
      throw stop;
    }
    return result;
  };
  await expect(runWaterDemo(pool, pool)).rejects.toBe(stop);
  const inserts = calls.filter((c) => /INSERT INTO bms.organizations/.test(c.sql));
  expect(inserts).toHaveLength(1);
  const [insert] = inserts;
  expect(insert?.sql, "the zone is a bound parameter, not a literal").not.toContain("'Asia/Kolkata'");
  expect(insert?.sql.replace(/s+/g, " ")).toContain(", $3, $4)");
  expect(insert?.values?.[3]).toBe(IONX_SITE_TIMEZONE);
}

/**
 * `F3.73` plan D12 — the IONX group is a `water` domain group, so a site-layout copy at the
 * demo plant binds its `water` tab. The upsert changes a row only while its domain is NULL, so
 * a re-run still writes 0 rows and an administrator's re-filing stands.
 */
export function assertTheIonxGroupIsAWaterDomainGroup(): void {
  const sql = IONX_GROUP_UPSERT_SQL.replace(/\s+/g, " ");
  expect(sql, "the insert must write the water domain").toContain(
    "(location_id, code, name, description, organization_id, domain) VALUES ($1, $2, $3, $4, $5, 'water')",
  );
  expect(sql, "an existing row must gain the domain only while it has none").toContain(
    "ON CONFLICT (location_id, code) DO UPDATE SET domain = EXCLUDED.domain WHERE bms.asset_groups.domain IS NULL",
  );
}

/** The six renames of ADR 0142 Amendment 4 item 4, each with its table and the one column it changes. */
const RENAMES: ReadonlyArray<readonly [sql: string, table: string, column: string]> = [
  [IONX_RENAME_ORG_SQL, "bms.organizations", "name"],
  [IONX_RENAME_SITE_SQL, "bms.locations", "name"],
  [IONX_RENAME_RTU_SQL, "bms.rtus", "display_name"],
  [IONX_RENAME_ASSET_SITE_SQL, "bms.assets", "site_name"],
  [IONX_RENAME_GROUP_SQL, "bms.asset_groups", "description"],
  [IONX_RENAME_ADMIN_SQL, "bms.users", "display_name"],
];

/**
 * ADR 0142 Amendment 4 item 4 — every rename is an `UPDATE` of one column, and its `WHERE` ends by
 * holding that column to the last parameter, the old default. So a name an operator edited matches
 * nothing, and neither does a second run. The new name is the parameter before it.
 */
export function assertEachRenameIsGuardedByTheOldName(): void {
  for (const [sql, table, column] of RENAMES) {
    const flat = sql.split(/\s+/).filter(Boolean).join(" ");
    const last = Math.max(...[...flat.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    expect(flat.startsWith(`UPDATE ${table} SET ${column} = $${last - 1} WHERE `), table).toBe(true);
    expect(flat.endsWith(` AND ${column} = $${last}`), table).toBe(true);
    // One column and one statement: nothing else is set, and no row is added or removed.
    expect(flat.split(" SET "), table).toHaveLength(2);
    expect(flat.split(" WHERE ")[0], table).not.toContain(",");
    expect(flat, table).not.toContain("INSERT");
    expect(flat, table).not.toContain("DELETE");
  }
  // No new name is an old one; the old ones are the names being removed; no new one names the client.
  const pairs: ReadonlyArray<readonly [now: string, before: string]> = [
    [IONX_ORG_NAME, IONX_NAMES_BEFORE_RENAME.organization],
    [IONX_SITE_NAME, IONX_NAMES_BEFORE_RENAME.site],
    [IONX_RTU_DISPLAY_NAME, IONX_NAMES_BEFORE_RENAME.rtu],
    [IONX_GROUP_DESCRIPTION, IONX_NAMES_BEFORE_RENAME.groupDescription],
    [IONX_ADMIN_DISPLAY_NAME, IONX_NAMES_BEFORE_RENAME.admin],
  ];
  for (const [now, before] of pairs) {
    expect(now).not.toBe(before);
    expect(before).toContain("Ion Exchange");
    expect(now.toLowerCase()).not.toContain("ion exchange");
  }
}

/**
 * ADR 0142 Amendment 4 item 4 — the command runs each rename once, bound to its own row's key, then
 * the new name, then the old one. The fake pool's read-back is not a complete tenant, so the run
 * ends on the post-condition, after the last rename.
 */
export async function assertTheCommandRenamesItsOwnRows(): Promise<void> {
  const { pool, calls } = recordingSeedPool({ organization: "org-id", dashboard: "dashboard-id", other: "other-id" });
  await expect(runWaterDemo(pool, pool)).rejects.toThrow("post-condition failed");
  const bound = (sql: string) => calls.filter((c) => c.sql === sql).map((c) => c.values);
  const before = IONX_NAMES_BEFORE_RENAME;
  expect(bound(IONX_RENAME_ORG_SQL)).toEqual([[IONX_ORG_CODE, IONX_ORG_NAME, before.organization]]);
  expect(bound(IONX_RENAME_SITE_SQL)).toEqual([["org-id", IONX_SITE_SLUG, IONX_SITE_NAME, before.site]]);
  expect(bound(IONX_RENAME_RTU_SQL)).toEqual([["other-id", IONX_RTU_CODE, IONX_RTU_DISPLAY_NAME, before.rtu]]);
  expect(bound(IONX_RENAME_ASSET_SITE_SQL)).toEqual([["org-id", "other-id", IONX_SITE_NAME, before.site]]);
  expect(bound(IONX_RENAME_GROUP_SQL)).toEqual([
    ["other-id", IONX_GROUP_CODE, IONX_GROUP_DESCRIPTION, before.groupDescription],
  ]);
  expect(bound(IONX_RENAME_ADMIN_SQL)).toEqual([[IONX_ADMIN_EMAIL, "org-id", IONX_ADMIN_DISPLAY_NAME, before.admin]]);
  // Each rename follows the insert of its own row: a fresh host inserts the new name and renames nothing.
  const at = (fragment: string) => calls.findIndex((c) => c.sql.includes(fragment));
  expect(at("UPDATE bms.organizations")).toBeGreaterThan(at("INSERT INTO bms.organizations"));
  expect(at("UPDATE bms.locations")).toBeGreaterThan(at("INSERT INTO bms.locations"));
  expect(at("UPDATE bms.rtus")).toBeGreaterThan(at("INSERT INTO bms.rtus"));
  expect(at("UPDATE bms.assets SET site_name")).toBeGreaterThan(at("INSERT INTO bms.assets"));
  expect(at("UPDATE bms.users")).toBeGreaterThan(at("INSERT INTO bms.users"));
}

/**
 * ADR 0142 Amendment 4 item 4 — the result counts what the renames changed. The fake pool is an
 * older host: every insert finds its row (0 rows), each rename changes its row (the asset rename
 * all five), and the read-back is complete. So `renamed` is 10, and `written` includes it — the
 * command must not print "this run changed nothing" for a run that renamed rows.
 */
export async function assertTheResultCountsTheRenamedRows(): Promise<void> {
  const { pool } = recordingSeedPool({ organization: "org-id", dashboard: "dashboard-id", other: "other-id" });
  const recording = pool.query.bind(pool) as (sql: string, values?: unknown[]) => Promise<{ rows: object[] }>;
  const renamedBy = new Map<string, number>(RENAMES.map(([sql]) => [sql, 1]));
  renamedBy.set(IONX_RENAME_ASSET_SITE_SQL, IONX_ASSET_CODES.length);
  const complete = { ...IONX_EXPECTED, ...COMPLETE_IDENTITY };
  (pool as unknown as { query: unknown }).query = async (sql: string, values?: unknown[]) => {
    const result = await recording(sql, values);
    return { rows: result.rows.map((row) => ({ ...row, ...complete })), rowCount: renamedBy.get(sql) ?? 0 };
  };
  const result = await runWaterDemo(pool, pool);
  expect(result.renamed).toBe(5 + IONX_ASSET_CODES.length);
  expect(result.written).toBe(result.renamed);
}
