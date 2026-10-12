import { expect, test } from "@playwright/test";

import { apiGet, apiStatus, authFile, readFixtures, tokenFromStorageState } from "../src/api.js";

/**
 * ADR 0100 path 5 — a location-scoped administrator sees only the locations
 * the grant covers.
 *
 * `wc-admin@bms.local` holds one location grant: the `RSMOC-WC` row
 * (`packages/db/src/demo-users-seed.ts`). `CSMOC-GP` is outside it.
 *
 * The list is the claim. `AdminLocationsService.list` filters by the
 * caller's writable location ids (`apps/api/src/admin/locations/locations.service.ts`);
 * a list that drops that filter still answers 200, and "CSMOC Gauteng" then
 * appears in the table. The direct URL and the 403 are the scope's other two
 * surfaces, each with a positive control beside it.
 */

const WC_NAME = "RSMOC Western Cape";
const GAUTENG_NAME = "CSMOC Gauteng";
// `apps/web/src/pages/control-room/site-page.tsx` `NotAvailableCard`.
const NOT_IN_SCOPE = "This site is not available in your access scope.";

test.use({ storageState: authFile("wc-admin") });

test.describe("path 5 — location scope", () => {
  test("the location list shows the granted site and not the other one", async ({ page }) => {
    await page.goto("/admin/locations");
    await expect(page.getByRole("heading", { level: 1, name: "Locations" })).toBeVisible();

    const rows = page.locator("tbody tr");
    await expect(rows.filter({ hasText: WC_NAME })).toHaveCount(1);
    await expect(rows.filter({ hasText: GAUTENG_NAME })).toHaveCount(0);

    const token = tokenFromStorageState(authFile("wc-admin"));
    const list = await apiGet<{ items: { id: string; code: string }[] }>("/api/v1/admin/locations", token);
    expect(list.items.map((item) => item.code)).toEqual(["RSMOC-WC"]);
  });

  test("a direct URL to the other site is refused", async ({ page }) => {
    const { wcLocationId, gautengLocationId } = readFixtures();

    await page.goto(`/control-room/site/${wcLocationId}`);
    await expect(page.getByRole("heading", { level: 1, name: WC_NAME })).toBeVisible();
    await expect(page.getByText(NOT_IN_SCOPE)).toHaveCount(0);

    await page.goto(`/control-room/site/${gautengLocationId}`);
    await expect(page.getByText(NOT_IN_SCOPE, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: GAUTENG_NAME })).toHaveCount(0);

    const token = tokenFromStorageState(authFile("wc-admin"));
    expect(await apiStatus(`/api/v1/admin/locations/${wcLocationId}`, token)).toBe(200);
    expect(await apiStatus(`/api/v1/admin/locations/${gautengLocationId}`, token)).toBe(403);
  });
});
