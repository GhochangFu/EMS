import { expect, type Page, test } from "@playwright/test";

import { apiGet, authFile, readFixtures, tokenFromStorageState } from "../src/api.js";
import { RUN_ID, slugOf } from "../src/run-id.js";

/**
 * ADR 0100 path 4 — an administrator builds the master-data chain through the
 * admin pages: a location, an RTU under it, an asset on that RTU, and a point
 * mapping on the asset.
 *
 * Every record carries the run's prefix (ADR 0100 decision 7), so a second run
 * on the same database passes and leaves its rows beside the first (plan §8
 * ruling 3). Each step reaches the next page by clicking the new row, so the
 * row's navigation is part of the path, and the URL carries the id the API
 * reports for that row.
 *
 * The mapping after a reload is the claim. `AdminAssetPointsService.create`
 * (`apps/api/src/admin/asset-points/asset-points.service.ts`) writes the row;
 * a create that answers without the insert still closes the dialog, and the
 * `kw` row is then absent from the table and from the API list.
 */

const LOCATION_CODE = `${RUN_ID}-LOC`;
const LOCATION_SLUG = slugOf(LOCATION_CODE);
const LOCATION_NAME = `E2E ${RUN_ID} location`;
const RTU_CODE = `${RUN_ID}-RTU`;
const RTU_NAME = `E2E ${RUN_ID} RTU`;
const ASSET_CODE = `${RUN_ID}-AST`;
const ASSET_NAME = `E2E ${RUN_ID} asset`;
const SITE_NAME = `E2E ${RUN_ID}`;
const POINT_KEY = "kw";
const SOURCE_KEY = `${RUN_ID}-kw`;

type Listed = { id: string; code: string };
type AssetPoint = { id: string; assetId: string; pointKey: string; sourceDataKey: string };

/** The modal form the page opened: the element that holds that heading. */
function modal(page: Page, heading: string) {
  return page.getByRole("heading", { level: 2, name: heading, exact: true }).locator("xpath=..");
}

/**
 * `F3.86` PR 3a — a wizard the page opened (ADR 0099 decision 6): the dialog
 * the frame names after its heading (`components/admin/location-wizards.tsx`
 * `AdminWizardFrame`, `role="dialog"` with that `aria-label`). The location
 * and RTU forms are wizards; the asset and mapping forms are still modals.
 */
function wizard(page: Page, heading: string) {
  return page.getByRole("dialog", { name: heading, exact: true });
}

/** A wizard's Next, then its Review step's Submit: one Next per step after the open one. */
async function nextThenSubmit(dialog: ReturnType<typeof wizard>, nexts: number): Promise<void> {
  for (let step = 0; step < nexts; step += 1) {
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
  }
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
}

/** The table row whose Code cell is exactly `code`. */
function rowByCode(page: Page, code: string) {
  return page.locator("tbody tr").filter({ has: page.getByRole("cell", { name: code, exact: true }) });
}

async function only<T extends Listed>(token: string, path: string, code: string): Promise<T> {
  const { items } = await apiGet<{ items: T[] }>(path, token);
  const matches = items.filter((item) => item.code === code);
  if (matches.length !== 1) throw new Error(`${path} lists ${matches.length} rows with code ${code}`);
  return matches[0]!;
}

test.use({ storageState: authFile("admin") });

test.describe("path 4 — master data", () => {
  test("location, RTU, asset and point mapping are created through the admin pages", async ({ page }) => {
    const token = tokenFromStorageState(authFile("admin"));
    const { eskomOrganizationId } = readFixtures();
    let locationId = "";
    let rtuId = "";
    let assetId = "";

    await test.step("add a location", async () => {
      await page.goto("/admin/locations");
      await expect(page.getByRole("heading", { level: 1, name: "Locations" })).toBeVisible();
      await page.getByRole("button", { name: "Add location", exact: true }).click();

      // Basics → Place → Metadata → Review (`location.create`).
      const form = wizard(page, "Add location");
      await form.getByRole("combobox", { name: "Organization", exact: true }).selectOption(eskomOrganizationId);
      await expect(form.getByRole("combobox", { name: "Parent", exact: true })).toHaveValue("");
      // The wizard reads the location types when it opens; until they load, the body has no type.
      await expect(form.getByRole("combobox", { name: "Type", exact: true })).not.toHaveValue("");
      await form.getByLabel("code", { exact: true }).fill(LOCATION_CODE);
      await form.getByLabel("slug", { exact: true }).fill(LOCATION_SLUG);
      await form.getByLabel("name", { exact: true }).fill(LOCATION_NAME);
      await form.getByRole("button", { name: "Next", exact: true }).click();
      await form.getByLabel("Latitude", { exact: true }).fill("-26.2");
      await form.getByLabel("Longitude", { exact: true }).fill("28.0");
      await nextThenSubmit(form, 2);
      await expect(form).toHaveCount(0);

      await page.getByPlaceholder("Search").fill(LOCATION_CODE);
      await expect(rowByCode(page, LOCATION_CODE)).toHaveCount(1);
      locationId = (await only(token, "/api/v1/admin/locations", LOCATION_CODE)).id;

      await rowByCode(page, LOCATION_CODE).getByRole("cell", { name: LOCATION_CODE, exact: true }).click();
      await expect(page).toHaveURL(`/admin/locations/${locationId}/rtus`);
    });

    await test.step("add an RTU at the location", async () => {
      await page.getByRole("button", { name: "Add RTU", exact: true }).click();

      // Basics → Source → Metadata → Review (`rtu.create`).
      const form = wizard(page, "Add RTU");
      await expect(form.getByRole("combobox", { name: "Location", exact: true })).toHaveValue(locationId);
      await form.getByLabel("Code", { exact: true }).fill(RTU_CODE);
      await form.getByLabel("Display name", { exact: true }).fill(RTU_NAME);
      await form.getByRole("combobox", { name: "Source type", exact: true }).selectOption("simulator");
      await nextThenSubmit(form, 3);
      await expect(form).toHaveCount(0);

      await expect(rowByCode(page, RTU_CODE)).toHaveCount(1);
      await expect(rowByCode(page, RTU_CODE)).toContainText("simulator");
      rtuId = (await only(token, `/api/v1/admin/rtus?locationId=${locationId}`, RTU_CODE)).id;

      await rowByCode(page, RTU_CODE).getByRole("cell", { name: RTU_CODE, exact: true }).click();
      await expect(page).toHaveURL(`/admin/locations/${locationId}/rtus/${rtuId}/assets`);
    });

    await test.step("add an asset on the RTU", async () => {
      await page.getByRole("button", { name: "Add asset", exact: true }).click();

      const form = modal(page, "Add asset");
      await form.getByLabel("Code", { exact: true }).fill(ASSET_CODE);
      await form.getByLabel("Name", { exact: true }).fill(ASSET_NAME);
      await form.getByLabel("Site name", { exact: true }).fill(SITE_NAME);
      await expect(form.getByRole("combobox", { name: "Location", exact: true })).toHaveValue(locationId);
      await expect(form.getByRole("combobox", { name: "RTU", exact: true })).toHaveValue(rtuId);
      await form.getByRole("combobox", { name: "Domain", exact: true }).selectOption("electrical");
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(form).toHaveCount(0);

      await expect(rowByCode(page, ASSET_CODE)).toHaveCount(1);
      await expect(rowByCode(page, ASSET_CODE)).toContainText(RTU_NAME);
      assetId = (await only(token, `/api/v1/admin/assets?rtuId=${rtuId}`, ASSET_CODE)).id;

      await rowByCode(page, ASSET_CODE).getByRole("cell", { name: ASSET_CODE, exact: true }).click();
      await expect(page).toHaveURL(`/admin/assets/${assetId}/points`);
    });

    await test.step("map the kw point and keep it after a reload", async () => {
      await page.getByRole("button", { name: "Add mapping", exact: true }).click();

      const form = modal(page, "Add mapping");
      await form.getByRole("combobox", { name: "Point key", exact: true }).selectOption(POINT_KEY);
      await form.getByLabel("Source data key", { exact: true }).fill(SOURCE_KEY);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(form).toHaveCount(0);

      const mapping = () =>
        page
          .locator("tbody tr")
          .filter({ has: page.getByRole("cell", { name: POINT_KEY, exact: true }) })
          .filter({ has: page.getByRole("cell", { name: SOURCE_KEY, exact: true }) });
      await expect(mapping()).toHaveCount(1);

      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Asset Points" })).toBeVisible();
      await expect(mapping()).toHaveCount(1);
      await expect(mapping()).toContainText(ASSET_CODE);

      const { items } = await apiGet<{ items: AssetPoint[] }>(
        `/api/v1/admin/asset-points?assetId=${assetId}`,
        token,
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ assetId, pointKey: POINT_KEY, sourceDataKey: SOURCE_KEY });
    });
  });
});
