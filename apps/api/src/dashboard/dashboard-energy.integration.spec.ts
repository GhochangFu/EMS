import type pg from "pg";

import { createDb } from "@bms/db";

import { AssetHealthService } from "../asset-health/asset-health.service";
import { DashboardService } from "./dashboard.service";
import { insertSampleBeforeNow, seedAsset, seedSite, type Site } from "./dashboard-freshness.integration.spec";

/**
 * `F4.364` (ADR 0133 decisions 2–4, plan U5 and rulings Q5/Q6) — the location summary's four
 * energy fields against a real database: `energyShown`, the resolved `primaryMetric`,
 * `healthScore` and a nullable `totalKw`. The resolution rule itself is table-tested in
 * `energy-features.spec.ts`; this file holds the SQL facts it is fed (the 30-day window, the
 * active-asset and `$2` scope predicates) and the one batch health read.
 *
 * Each case runs inside the caller's rolled-back transaction (`inRolledBackTransaction`) on a
 * fixture organization of its own, with a real `AssetHealthService` on the same client.
 */

const NO_TARIFFS = { resolveForAssets: async () => new Map<string, number>() };
const DAY = 86_400;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function service(client: pg.PoolClient): DashboardService {
  return new DashboardService(
    client as unknown as pg.Pool,
    NO_TARIFFS,
    new AssetHealthService(createDb(client as unknown as pg.Pool)),
  );
}

async function setOrganization(
  client: pg.PoolClient,
  site: Site,
  energyFeatures: string,
  cardPrimaryMetric = "auto",
): Promise<void> {
  await client.query(`UPDATE bms.organizations SET energy_features = $2, card_primary_metric = $3 WHERE id = $1`, [
    site.organizationId,
    energyFeatures,
    cardPrimaryMetric,
  ]);
}

/** The four fields of the site's own card, read through `locationKpis`. */
async function card(
  client: pg.PoolClient,
  site: Site,
  assetIds: string[] | null = null,
): Promise<{ energyShown: unknown; primaryMetric: unknown; totalKw: unknown; healthScore: unknown }> {
  const { items } = await service(client).locationKpis({ locationIds: [site.locationId], assetIds });
  const row = items[0];
  assert(row !== undefined, "the fixture location must have a card");
  const { energyShown, primaryMetric, totalKw, healthScore } = row as NonNullable<typeof row>;
  return { energyShown, primaryMetric, totalKw, healthScore };
}

function expectCard(got: Awaited<ReturnType<typeof card>>, want: Partial<Awaited<ReturnType<typeof card>>>, what: string): void {
  for (const [key, value] of Object.entries(want)) {
    const actual = got[key as keyof typeof got];
    assert(actual === value, `${what}: ${key} = ${JSON.stringify(actual)}, expected ${JSON.stringify(value)} (card ${JSON.stringify(got)})`);
  }
}

/** A counter row scoring `inRange / samples` on every rung a one-day read may choose (1m, 5m, 1h). */
async function scoreAsset(client: pg.PoolClient, assetId: string, inRange: number, samples: number): Promise<void> {
  for (const level of ["1m", "5m", "1h"]) {
    await client.query(
      `INSERT INTO telemetry.point_in_range_${level}
         (bucket, asset_id, point_key, in_range_count, sample_count, rule_count, skipped_rule_count, computed_at)
       VALUES (date_trunc('hour', now()) - interval '2 hours', $1, 'temp_c', $2, $3, 1, 0, now())`,
      [assetId, inRange, samples],
    );
  }
}

/** G1 — `auto` with a `kw` 5 s old: shown, `kw`, 42, no health read. */
export async function assertAutoWithFreshKwIsShown(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "A");
  await insertSampleBeforeNow(client, a, "kw", 42, 5);
  expectCard(await card(client, site), { energyShown: true, primaryMetric: "kw", totalKw: 42, healthScore: null }, "auto + kw 5 s old");
}

/** G2 — the 30-day window: a `kw` 31 days old is not energy data, 29 days old is. */
export async function assertTheThirtyDayWindow(client: pg.PoolClient): Promise<void> {
  const old = await seedSite(client);
  const a = await seedAsset(client, old, "OLD");
  await insertSampleBeforeNow(client, a, "kw", 42, 31 * DAY);
  expectCard(await card(client, old), { energyShown: false, primaryMetric: "health", totalKw: null }, "kw 31 days old");

  const recent = await seedSite(client);
  const b = await seedAsset(client, recent, "RECENT");
  await insertSampleBeforeNow(client, b, "kw", 42, 29 * DAY);
  expectCard(await card(client, recent), { energyShown: true, primaryMetric: "kw", totalKw: 42 }, "kw 29 days old");
}

/** G3 — only a `temp_c` sample: not shown, health. */
export async function assertOnlyTemperatureIsNotShown(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "T");
  await insertSampleBeforeNow(client, a, "temp_c", 4, 5);
  expectCard(await card(client, site), { energyShown: false, primaryMetric: "health", totalKw: null }, "only temp_c");
}

/** G4 — `on` with no `kw` anywhere: shown, and `totalKw` is `null`, never `0`. */
export async function assertOnWithoutKwIsNullNotZero(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  await seedAsset(client, site, "N");
  await setOrganization(client, site, "on");
  expectCard(await card(client, site), { energyShown: true, primaryMetric: "kw", totalKw: null }, "on + no kw");
}

/** G5 — `off` with a fresh `kw`: not shown, `null`. */
export async function assertOffHidesAFreshKw(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "F");
  await insertSampleBeforeNow(client, a, "kw", 42, 5);
  await setOrganization(client, site, "off");
  expectCard(await card(client, site), { energyShown: false, primaryMetric: "health", totalKw: null }, "off + fresh kw");
}

/** G6 — the only `kw` asset is inactive: not energy data. */
export async function assertAnInactiveKwAssetIsNotEnergyData(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "I");
  await insertSampleBeforeNow(client, a, "kw", 42, 5);
  await client.query(`UPDATE bms.assets SET active = false WHERE id = $1`, [a]);
  expectCard(await card(client, site), { energyShown: false, totalKw: null }, "the only kw asset inactive");
}

/** G7 — the `kw` asset is outside `$2`: not energy data for this caller; inside it is (positive control). */
export async function assertAKwAssetOutsideTheScopeIsNotEnergyData(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const metered = await seedAsset(client, site, "M");
  const other = await seedAsset(client, site, "O");
  await insertSampleBeforeNow(client, metered, "kw", 42, 5);
  expectCard(await card(client, site, [metered]), { energyShown: true, totalKw: 42 }, "kw asset in scope");
  expectCard(await card(client, site, [other]), { energyShown: false, totalKw: null }, "kw asset outside $2");
}

/** G8 — `auto` never reaches the wire, for any of the five card settings. */
export async function assertAutoIsNeverOnTheWire(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  await seedAsset(client, site, "W");
  for (const setting of ["auto", "kw", "health", "critical_alarms", "none"]) {
    await setOrganization(client, site, "auto", setting);
    const got = await card(client, site);
    assert(got.primaryMetric !== "auto", `card setting ${setting}: primaryMetric must be resolved, got auto`);
    assert(got.primaryMetric === (setting === "auto" ? "health" : setting), `card setting ${setting}: got ${String(got.primaryMetric)}`);
  }
}

/** G9 — Q6: a `health` card carries the fixture's score; a `kw` card carries `healthScore: null`. */
export async function assertOnlyAHealthCardIsScored(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "H");
  await scoreAsset(client, a, 3, 4);
  expectCard(await card(client, site), { primaryMetric: "health", healthScore: 0.75 }, "a health card");

  await setOrganization(client, site, "auto", "kw");
  expectCard(await card(client, site), { primaryMetric: "kw", healthScore: null }, "the same location as a kw card");
}

/** G10 — `locationDashboard` carries the same four fields. */
export async function assertTheLocationDashboardCarriesTheFields(client: pg.PoolClient): Promise<void> {
  const site = await seedSite(client);
  const a = await seedAsset(client, site, "D");
  await scoreAsset(client, a, 1, 4);
  const dto = await service(client).locationDashboard(site.locationId, { locationIds: null, assetIds: null });
  assert(dto !== null, "the fixture location must have a dashboard");
  const { energyShown, primaryMetric, totalKw, healthScore } = dto as NonNullable<typeof dto>;
  expectCard(
    { energyShown, primaryMetric, totalKw, healthScore },
    { energyShown: false, primaryMetric: "health", totalKw: null, healthScore: 0.25 },
    "locationDashboard",
  );
}
