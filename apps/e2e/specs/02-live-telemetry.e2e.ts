import { expect, test } from "@playwright/test";

import { apiGet, authFile, tokenFromStorageState } from "../src/api.js";

/**
 * ADR 0100 path 2 — a live value from `apps/sim` reaches the screen.
 *
 * The screen is the generated site view (`/control-room/site/:locationId`),
 * whose `point-value` cells are fed by `useSiteLiveReadings` over
 * `/ws/telemetry`. **The site is `RSMOC-GP`, not `CSMOC-GP`:** the seed gives
 * `CSMOC-GP` a `dashboard` view (`packages/db/src/site-layout-seed.ts`) and
 * `RSMOC-WC` the SMOC tabs, while a site with no view row falls through to
 * the generated view (`apps/api/src/control-room/site-control-room-view.pure.ts`).
 *
 * The claim is the socket. The generated read itself refetches every 30 s, so
 * the "the cell changes" wait stays well under that: a page whose socket
 * handler drops every reading keeps the first value past the wait.
 */

const SITE_CODE = "RSMOC-GP";
const POINT_KEY = "kw";
// `HEADLINE_POINT_COUNT` (`packages/shared/src/contracts/generated-site-view.ts`):
// the card shows this many points before "All points" is pressed.
const HEADLINE_POINT_COUNT = 4;
// The sim publishes at 1 Hz; a sample older than this is not from the running sim.
const FRESH_SAMPLE_MS = 15_000;
// Under the 30 s refetch of the generated read, with margin for the first paint.
const CHANGE_TIMEOUT_MS = 15_000;

type GeneratedPoint = {
  pointKey: string;
  name: string | null;
  latest: { value: number; time: string } | null;
};
type GeneratedAsset = { id: string; code: string; name: string; points: GeneratedPoint[] };
type GeneratedView = { domains: { assets: GeneratedAsset[] }[] };
type Reading = { time: string; value: number };

/** `encodePointRef` (`packages/shared/src/index.ts`): `assetId::pointKey`, URI-encoded once. */
function pointRef(assetId: string, pointKey: string): string {
  return encodeURIComponent(`${assetId}::${pointKey}`);
}

/**
 * `formatPointValue` (`apps/web/src/lib/generated-site-view.ts`) is web-only,
 * so the spec compares numerically at the card's precision (two decimals)
 * rather than importing the formatter (plan §8 ruling 4).
 */
function atCardPrecision(value: number): number {
  return Math.round(value * 100) / 100;
}

test.use({ storageState: authFile("admin") });

test.describe("path 2 — live telemetry", () => {
  test("a point value on the site view follows the simulator", async ({ page }) => {
    const token = tokenFromStorageState(authFile("admin"));

    const locations = await apiGet<{ items: { id: string; code: string; name: string; organizationCode?: string }[] }>(
      "/api/v1/admin/locations",
      token,
    );
    const site = locations.items.filter((l) => l.organizationCode === "ESKOM" && l.code === SITE_CODE);
    expect(site, `exactly one ESKOM location ${SITE_CODE}`).toHaveLength(1);
    const { id: locationId, name: siteName } = site[0];

    // Pick from data, not from the seed list: an asset whose `kw` shows without
    // "All points" and whose newest sample is fresh, so the sim emits that key.
    const view = await apiGet<GeneratedView>(
      `/api/v1/control-room/sites/${encodeURIComponent(locationId)}/generated`,
      token,
    );
    const now = Date.now();
    const candidates = view.domains
      .flatMap((d) => d.assets)
      .filter((asset) => {
        const idx = asset.points.findIndex((p) => p.pointKey === POINT_KEY);
        const latest = idx < 0 ? null : asset.points[idx].latest;
        return (
          idx >= 0 &&
          idx < HEADLINE_POINT_COUNT &&
          latest !== null &&
          now - Date.parse(latest.time) < FRESH_SAMPLE_MS
        );
      });
    expect(candidates.length, `an asset at ${SITE_CODE} with a fresh headline ${POINT_KEY}`).toBeGreaterThan(0);
    const asset = candidates[0];
    const point = asset.points.find((p) => p.pointKey === POINT_KEY);
    if (point === undefined) throw new Error(`${asset.code} lost its ${POINT_KEY} point`);
    const rowName = point.name ?? point.pointKey;

    await page.goto(`/control-room/site/${locationId}`);
    await expect(page.getByRole("heading", { level: 1, name: siteName })).toBeVisible();

    // The generated view's card; a regression to another view kind fails here.
    const card = page.getByRole("article", { name: `${asset.code} ${asset.name}`, exact: true });
    await expect(card).toBeVisible();
    const cell = card
      .locator("tr")
      .filter({ has: page.getByRole("rowheader", { name: rowName, exact: true }) })
      .getByTestId("point-value");
    await expect(cell).toHaveCount(1);
    await expect(cell).toHaveText(/^-?\d+(\.\d+)?$/);

    const t0 = (await cell.textContent()) ?? "";
    await expect(cell).not.toHaveText(t0, { timeout: CHANGE_TIMEOUT_MS });

    // The cell equals the newest stored reading. Read both in one attempt:
    // the sim ticks at 1 Hz, so either side may move between two reads.
    const recentPath = `/api/v1/telemetry/points/${pointRef(asset.id, POINT_KEY)}/recent?window=15m`;
    await expect(async () => {
      const shown = Number(await cell.textContent());
      const recent = await apiGet<Reading[]>(recentPath, token);
      expect(recent.length).toBeGreaterThan(0);
      expect(shown).toBe(atCardPrecision(recent[0].value));
    }).toPass({ timeout: 10_000 });
  });
});
