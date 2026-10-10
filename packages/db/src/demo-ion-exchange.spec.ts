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
  ionxAssetCodeFor,
  runIonExchangeDemo,
  ionxShortfalls,
  type IonxIdentityCounts,
  type IonxTenantCounts,
} from "./demo-ion-exchange";
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
  await expect(runIonExchangeDemo(pool, pool)).rejects.toBe(stop);
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
  await expect(runIonExchangeDemo(pool, pool)).rejects.toBe(stop);
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
