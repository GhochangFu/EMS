import { expect, test } from "@playwright/test";

import { BASE_URL, DEMO_PASSWORD, ROLES } from "../src/api.js";

/**
 * ADR 0100 path 1 — local login through the form, and the session survives a
 * reload.
 *
 * No `storageState`: this is the one spec that drives the login form. The
 * other four start from the sessions `global-setup.ts` writes.
 *
 * The reload is the claim. `apps/web/src/stores/auth-store.ts` persists the
 * token under `bms-auth` through zustand's `partialize`; a store that stops
 * persisting `accessToken` still signs in, but the reload lands on `/login`.
 */

// `apps/web/src/pages/dashboard-page.tsx` `DASHBOARD_TITLE`, the `/` page heading.
const DASHBOARD_TITLE = "Control Room · Estate";
const ADMIN_EMAIL = ROLES.admin;

test.describe("path 1 — local login", () => {
  test("the form signs in and the session survives a reload", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(ADMIN_EMAIL);
    await page.locator("#password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in securely", exact: true }).click();

    const heading = page.getByRole("heading", { level: 1, name: DASHBOARD_TITLE });
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await expect(heading).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(`${BASE_URL}/`);
    await expect(heading).toBeVisible();

    const raw = await page.evaluate(() => window.localStorage.getItem("bms-auth"));
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw ?? "null") as {
      state?: { accessToken?: unknown; user?: { email?: unknown } | null };
    };
    expect(typeof persisted.state?.accessToken).toBe("string");
    expect(persisted.state?.accessToken).not.toBe("");
    expect(persisted.state?.user?.email).toBe(ADMIN_EMAIL);
  });

  test("a wrong password shows the refusal and stays on /login", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(ADMIN_EMAIL);
    await page.locator("#password").fill(`${DEMO_PASSWORD}-wrong`);
    await page.getByRole("button", { name: "Sign in securely", exact: true }).click();

    await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
    await expect(page).toHaveURL(`${BASE_URL}/login`);
  });
});
