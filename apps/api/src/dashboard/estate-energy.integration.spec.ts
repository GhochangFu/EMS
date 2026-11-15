import type pg from "pg";

import { DashboardService } from "./dashboard.service";
import {
  insertSampleBeforeNow,
  seedAsset,
  seedLocation,
  seedSite,
  type Site,
} from "./dashboard-freshness.integration.spec";

/**
 * `F4.375` (ADR 0133 Amendment 2 ruling 1, plan U3 and D3–D5) — the estate ribbon's Total load
 * against a real database: `kpis()` sums the latest `kw` only over in-scope assets at **active**
 * locations whose energy is shown (decision 2's rule, the cards' own), says whether any location
 * in scope shows energy, and moves `prior.totalKw` to the same location set. Assertions live
 * here; the sibling `.integration.test.ts` owns the pool (ADR 0014).
 *
 * Every case runs in the caller's rolled-back transaction (`inRolledBackTransaction`) on fixture
 * organizations of its own, so the fleet's telemetry cannot move a scoped number. E7 reads the
 * global scope and therefore measures a delta inside one REPEATABLE READ snapshot (the
 * `kpi-prior.integration.spec.ts` precedent).
 */

const NO_TARIFFS = { resolveForAssets: async () => new Map<string, number>() };
const NO_HEALTH = { scoresByLocation: async () => new Map<string, number | null>() };
const DAY = 86_400;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function service(client: pg.PoolClient): DashboardService {
  return new DashboardService(client as unknown as pg.Pool, NO_TARIFFS, NO_HEALTH);
}

async function setEnergyFeatures(client: pg.PoolClient, site: Site, value: "auto" | "on" | "off"): Promise<void> {
  await client.query("UPDATE bms.organizations SET energy_features = $2 WHERE id = $1", [site.organizationId, value]);
}

async function ribbon(client: pg.PoolClient, assetIds: string[] | null): Promise<{ energyShown: boolean; totalKw: number | null }> {
  const { energyShown, totalKw } = await service(client).kpis(assetIds);
  return { energyShown, totalKw };
}

function expectRibbon(got: { energyShown: boolean; totalKw: number | null }, want: typeof got, what: string): void {
  assert(
    got.energyShown === want.energyShown && got.totalKw === want.totalKw,
    `${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
  );
}

/** E1 — site A (`auto`, fresh `kw` 42) and site B (only `temp_c`) → shown, 42. */
export async function assertTheShownSiteIsSummed(client: pg.PoolClient): Promise<void> {
  const a = await seedSite(client);
  const b = await seedSite(client);
  const meter = await seedAsset(client, a, "M");
  const sensor = await seedAsset(client, b, "T");
  await insertSampleBeforeNow(client, sensor, "temp_c", 21, 5);
  await insertSampleBeforeNow(client, meter, "kw", 42, 5);
  expectRibbon(await ribbon(client, [meter, sensor]), { energyShown: true, totalKw: 42 }, "E1");
}

/** E2 — B's only `kw` (100) is 31 days old, so B is not shown and its value is not summed (it was: 142). */
export async function assertAnOldKwIsNotSummed(client: pg.PoolClient): Promise<void> {
  const a = await seedSite(client);
  const b = await seedSite(client);
  const meter = await seedAsset(client, a, "M");
  const old = await seedAsset(client, b, "O");
  await insertSampleBeforeNow(client, old, "kw", 100, 31 * DAY);
  await insertSampleBeforeNow(client, meter, "kw", 42, 5);
  expectRibbon(await ribbon(client, [meter, old]), { energyShown: true, totalKw: 42 }, "E2");
}

/** E3 — B's organization is `off`, so its fresh `kw` 100 is not summed. */
export async function assertAnOffOrganizationIsNotSummed(client: pg.PoolClient): Promise<void> {
  const a = await seedSite(client);
  const b = await seedSite(client);
  await setEnergyFeatures(client, b, "off");
  const meter = await seedAsset(client, a, "M");
  const hidden = await seedAsset(client, b, "H");
  await insertSampleBeforeNow(client, hidden, "kw", 100, 5);
  await insertSampleBeforeNow(client, meter, "kw", 42, 5);
  expectRibbon(await ribbon(client, [meter, hidden]), { energyShown: true, totalKw: 42 }, "E3");
}

/** E4 — only no-energy locations in scope → not shown, `null` (never `0`). */
export async function assertNoEnergyLocationIsNullNotZero(client: pg.PoolClient): Promise<void> {
  const a = await seedSite(client);
  const b = await seedSite(client);
  await setEnergyFeatures(client, b, "off");
  const sensor = await seedAsset(client, a, "T");
  const hidden = await seedAsset(client, b, "H");
  await insertSampleBeforeNow(client, hidden, "kw", 100, 5);
  await insertSampleBeforeNow(client, sensor, "temp_c", 21, 5);
  expectRibbon(await ribbon(client, [sensor, hidden]), { energyShown: false, totalKw: null }, "E4");
}

/** E5 — an `on` organization with no `kw` anywhere → shown, `null`. */
export async function assertOnWithoutKwIsShownWithNull(client: pg.PoolClient): Promise<void> {
  const a = await seedSite(client);
  await setEnergyFeatures(client, a, "on");
  const sensor = await seedAsset(client, a, "T");
  await insertSampleBeforeNow(client, sensor, "temp_c", 21, 5);
  expectRibbon(await ribbon(client, [sensor]), { energyShown: true, totalKw: null }, "E5");
}

/** E6 — the only `kw` asset is outside `$1` → not shown; inside → shown, 42 (the positive control). */
export async function assertTheScopeDecidesEnergyData(client: pg.PoolClient): Promise<void> {
  const a = await seedSite(client);
  const meter = await seedAsset(client, a, "M");
  const sensor = await seedAsset(client, a, "T");
  await insertSampleBeforeNow(client, sensor, "temp_c", 21, 5);
  await insertSampleBeforeNow(client, meter, "kw", 42, 5);
  expectRibbon(await ribbon(client, [sensor]), { energyShown: false, totalKw: null }, "E6 outside");
  expectRibbon(await ribbon(client, [meter, sensor]), { energyShown: true, totalKw: 42 }, "E6 inside");
}

/** E7 — `kpis(null)`: a shown site adds its 42; an `off` site adds nothing. Measured as a delta. */
export async function assertTheGlobalScopeSumsShownLocationsOnly(client: pg.PoolClient): Promise<void> {
  await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  const before = await ribbon(client, null);
  const a = await seedSite(client);
  const b = await seedSite(client);
  await setEnergyFeatures(client, b, "off");
  const meter = await seedAsset(client, a, "M");
  const hidden = await seedAsset(client, b, "H");
  await insertSampleBeforeNow(client, hidden, "kw", 100, 5);
  await insertSampleBeforeNow(client, meter, "kw", 42, 5);
  const after = await ribbon(client, null);
  const delta = (after.totalKw ?? 0) - (before.totalKw ?? 0);
  assert(after.energyShown && Math.abs(delta - 42) < 1e-6, `E7: the global total must rise by 42 only, rose by ${delta}`);
}

/** E8 — a fresh `kw` at an inactive location is not summed; the active site's 42 is the control (D3). */
export async function assertAnInactiveLocationIsNotSummed(client: pg.PoolClient): Promise<void> {
  const a = await seedSite(client);
  const dead = await seedLocation(client, a, false);
  const meter = await seedAsset(client, a, "M");
  const orphan = await seedAsset(client, dead, "D");
  await insertSampleBeforeNow(client, orphan, "kw", 100, 5);
  await insertSampleBeforeNow(client, meter, "kw", 42, 5);
  expectRibbon(await ribbon(client, [meter, orphan]), { energyShown: true, totalKw: 42 }, "E8");
}

/**
 * E9 — the prior sums the locations shown now (D4): A shown (`kw` 9 now, 6 a day and a minute
 * ago), B `off` (100 a day and a minute ago) → `totalKw` 9, `prior.totalKw` 6 (not 106).
 */
export async function assertThePriorSumsTheShownLocations(client: pg.PoolClient): Promise<void> {
  const a = await seedSite(client);
  const b = await seedSite(client);
  await setEnergyFeatures(client, b, "off");
  const meter = await seedAsset(client, a, "M");
  const hidden = await seedAsset(client, b, "H");
  await insertSampleBeforeNow(client, meter, "kw", 6, DAY + 60);
  await insertSampleBeforeNow(client, hidden, "kw", 100, DAY + 60);
  await insertSampleBeforeNow(client, meter, "kw", 9, 5);
  const kpis = await service(client).kpis([meter, hidden]);
  const got = { totalKw: kpis.totalKw, prior: kpis.prior.totalKw };
  assert(got.totalKw === 9 && got.prior === 6, `E9: expected { totalKw: 9, prior: 6 }, got ${JSON.stringify(got)}`);
}

/**
 * E10 — parity with the cards (D3): three sites — shown with a value, `on` without one, hidden
 * with an old value. The ribbon's total is the sum of the cards' non-null `totalKw`, and its
 * `energyShown` is `items.some(energyShown)`.
 */
export async function assertTheRibbonEqualsTheCards(client: pg.PoolClient): Promise<void> {
  const a = await seedSite(client);
  const b = await seedSite(client);
  const c = await seedSite(client);
  await setEnergyFeatures(client, b, "on");
  const meter = await seedAsset(client, a, "M");
  const sensor = await seedAsset(client, b, "T");
  const old = await seedAsset(client, c, "O");
  await insertSampleBeforeNow(client, old, "kw", 30, 40 * DAY);
  await insertSampleBeforeNow(client, sensor, "temp_c", 21, 5);
  await insertSampleBeforeNow(client, meter, "kw", 17, 5);
  const scope = [meter, sensor, old];
  const { items } = await service(client).locationKpis({
    locationIds: [a.locationId, b.locationId, c.locationId],
    assetIds: scope,
  });
  const cardSum = items.reduce((sum, item) => sum + (item.totalKw ?? 0), 0);
  const cardsShown = items.some((item) => item.energyShown);
  const got = await ribbon(client, scope);
  assert(
    items.length === 3 && got.totalKw === cardSum && got.energyShown === cardsShown && cardSum === 17,
    `E10: ribbon ${JSON.stringify(got)} vs cards { totalKw: ${cardSum}, energyShown: ${cardsShown} } over ${items.length} cards`,
  );
}
