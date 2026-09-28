import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope, UserRole } from "@bms/shared";

import * as assetsApi from "../api/assets";
import * as systemStatusApi from "../api/system-status";
import { OPERATIONAL } from "../components/system-status-indicator.spec";
import { useAuthStore, type AuthUser } from "../stores/auth-store";
import { useThemeStore } from "../stores/theme-store";
import {
  AppShell,
  COLLAPSED_LABEL_OVERRIDES,
  SETTINGS_LOCKED_REASON,
  collapsedRailEntries,
} from "./app-shell";

/**
 * `F3.66` U6 (ADR 0076 decision 1, OQ4, plan D9) — one sidebar entry,
 * *Control Room*, replaces the seven-item *Control Room 2D* group.
 *
 * Assertions live here; `app-shell.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * The entry sits in *Operations* directly after *Alarm Centre* and shows to
 * every scope that is not `none`; a `null` scope (still loading) shows no
 * entry. The shell issues no `fetchAssets()` — the F4.156 interim gate that
 * once observed `["assets"]` on the `/cr-*` routes is removed as of `F3.70`
 * U5b. The entry highlights for `/control-room` and every `/control-room/*`
 * path; every other item keeps its exact-match highlight.
 *
 * Every case stubs `fetchSystemStatus` (`F4.160` — an unstubbed read reaches a
 * local API on `:4000`) and spies `fetchAssets` (S5 asserts it is not called).
 */

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

/** An `organization_admin` gets `kind: "location"` — there is no `organization` kind. */
const LOCATION: AccessibleScope = {
  kind: "location",
  locations: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      code: "PHE-1",
      slug: "phe-1",
      name: "PHE plant",
      type: "smoc_campus",
      province: null,
    },
  ],
  assetGroups: [],
  assetIds: [],
};

const NONE: AccessibleScope = { kind: "none", locations: [], assetGroups: [], assetIds: [] };

function renderShell(
  scope: AccessibleScope | null,
  path = "/",
  role: UserRole = "organization_admin",
): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  useAuthStore.setState({ scope });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell user={asUser(role)} kpiRibbon={<span />}>
          body
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function sidebar(): HTMLElement {
  return screen.getByRole("complementary");
}

function entries(): HTMLElement[] {
  return within(sidebar()).queryAllByRole("link", { name: "Control Room" });
}

/** S1 — a `location`-scoped caller sees exactly one entry, pointing at `/control-room`. */
export function showsOneEntryToALocationScope(): void {
  renderShell(LOCATION);
  const links = entries();
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute("href", "/control-room");
}

/** S2 — a `none` scope sees no entry; Alarm Centre is the positive control. */
export function hidesTheEntryFromANoneScope(): void {
  renderShell(NONE);
  expect(within(sidebar()).getByRole("link", { name: "Alarm Centre" })).toBeInTheDocument();
  expect(entries()).toHaveLength(0);
}

/** S3 — a `null` scope (still loading) sees no entry; Alarm Centre is the positive control. */
export function hidesTheEntryWhileTheScopeIsNull(): void {
  renderShell(null);
  expect(within(sidebar()).getByRole("link", { name: "Alarm Centre" })).toBeInTheDocument();
  expect(entries()).toHaveLength(0);
}

/**
 * S4 — the *Control Room 2D* group is gone: no `/cr-*` link and no group
 * heading, read after S1's entry is present (the positive control).
 */
export function dropsTheControlRoom2dGroup(): void {
  renderShell(GLOBAL);
  expect(entries()).toHaveLength(1);
  expect(sidebar().querySelectorAll('a[href^="/cr-"]')).toHaveLength(0);
  expect(within(sidebar()).queryByText("Control Room 2D")).toBeNull();
}

/**
 * S5 — the shell issues no `fetchAssets()`: it no longer observes the
 * `["assets"]` read. The entry is the positive control that the shell
 * rendered, and one macrotask lets any mounted query start its fetch.
 */
export async function doesNotReadAssets(): Promise<void> {
  renderShell(GLOBAL);
  expect(entries()).toHaveLength(1);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(assetsApi.fetchAssets).not.toHaveBeenCalled();
}

/** S6 — D9: the entry is highlighted on a nested `/control-room/*` path. */
export function highlightsTheEntryOnANestedPath(): void {
  renderShell(GLOBAL, "/control-room/org/x");
  const [link] = entries();
  expect(link?.classList.contains("border-accent")).toBe(true);
}

/** S7 — OQ4: the entry is the item directly after *Alarm Centre*. */
export function placesTheEntryDirectlyAfterAlarmCentre(): void {
  renderShell(GLOBAL);
  const alarmCentre = within(sidebar()).getByRole("link", { name: "Alarm Centre" });
  const next = alarmCentre.closest("li")?.nextElementSibling;
  expect(next?.querySelector("a")?.getAttribute("href")).toBe("/control-room");
}

/**
 * S8 — the D9 prefix rule is the entry's alone: `Dashboards` stays exact-match,
 * so `/dashboards/<slug>` does not highlight it (it did not before U6).
 */
export function keepsOtherItemsExactMatch(): void {
  renderShell(GLOBAL, "/dashboards/plant-overview");
  const dashboards = within(sidebar()).getByRole("link", { name: "Dashboards" });
  expect(dashboards.classList.contains("border-transparent")).toBe(true);
}

/**
 * `F4.164` U2 — the locked top-nav Settings entry. For a role that is not a
 * master-data administrator it is a focusable `button` with
 * `aria-disabled="true"`, an accessible description holding
 * `SETTINGS_LOCKED_REASON`, and `text-on-dark/70` (3.43:1 on `chrome-nav`).
 * Every case reads inside the top navigation, where the entry lives.
 */
function topNav(): HTMLElement {
  return screen.getByRole("navigation");
}

function lockedSettings(): HTMLElement {
  return within(topNav()).getByRole("button", { name: "Settings" });
}

/** S9 — an `operator` gets a button named exactly "Settings", `aria-disabled="true"`. */
export function locksSettingsAsAnAriaDisabledButton(): void {
  renderShell(GLOBAL, "/", "operator");
  expect(lockedSettings()).toHaveAttribute("aria-disabled", "true");
}

/**
 * S10 — the description is carried by `aria-describedby`, resolved by id. A
 * `toHaveAccessibleDescription` check alone would pass on the `title`
 * fallback with the idref dropped.
 */
export function describesTheLockedSettingsReason(): void {
  renderShell(GLOBAL, "/", "operator");
  const id = lockedSettings().getAttribute("aria-describedby") ?? "";
  expect(document.getElementById(id)?.textContent).toBe(SETTINGS_LOCKED_REASON);
}

/** S11 — the button takes keyboard focus; a natively `disabled` one would not. */
export function letsTheLockedSettingsTakeFocus(): void {
  renderShell(GLOBAL, "/", "operator");
  const button = lockedSettings();
  act(() => {
    button.focus();
  });
  expect(button).toHaveFocus();
}

/** S12 — an `operator` gets no Settings link; the button is the positive control. */
export function givesAnOperatorNoSettingsLink(): void {
  renderShell(GLOBAL, "/", "operator");
  expect(lockedSettings()).toBeInTheDocument();
  expect(within(topNav()).queryByRole("link", { name: "Settings" })).toBeNull();
}

/** S13 — an `organization_admin` gets the `/admin` link and no locked button. */
export function givesAnOrganizationAdminTheSettingsLink(): void {
  renderShell(LOCATION, "/", "organization_admin");
  expect(within(topNav()).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/admin");
  expect(within(topNav()).queryByRole("button", { name: "Settings" })).toBeNull();
}

/** S14 — the text is `text-on-dark/70` (3.43:1 on chrome-nav), not the 2.48:1 `text-on-dark/50`. */
export function drawsTheLockedSettingsAtThreeToOne(): void {
  renderShell(GLOBAL, "/", "operator");
  const classes = lockedSettings().classList;
  expect(classes.contains("text-on-dark/70")).toBe(true);
  expect(classes.contains("text-on-dark/50")).toBe(false);
}

/**
 * `F4.164` U3 — the collapsed rail. A collapsed sidebar link carries
 * `aria-label="<label> (<code>)"`, so it announces its full title and its
 * accessible name still contains the visible code (WCAG 2.5.3 Label in Name);
 * an expanded link has no `aria-label` and takes its name from the label it
 * shows. `COLLAPSED_LABEL_OVERRIDES` makes the codes unique.
 *
 * L1–L3 gate the data: `collapsedRailEntries()` is every item of both lists,
 * the temporarily hidden ones included, so a collision that only shows once an
 * item is un-hidden or once a role sees the admin group is still caught.
 *
 * L4–L6 and L8 need one render only, `admin` with a `GLOBAL` scope. Every visibility
 * rule in `AppShell` only removes items (the hidden paths, `none`/`null` scope
 * for Control Room, the admin group for a non-admin, `catalogOnly` and
 * `globalOnly` for a lesser admin), and `admin` with `GLOBAL` passes all of
 * them, so that render shows the maximal set. Uniqueness of a set holds for
 * every subset of it, and an attribute present on every link of the maximal
 * set is present on every link of each role's subset.
 */
function renderCollapsedShell(): void {
  window.localStorage.setItem("bms-sidebar-collapsed", "true");
  renderShell(GLOBAL, "/", "admin");
}

function sidebarLinks(): HTMLElement[] {
  return within(sidebar()).getAllByRole("link");
}

function duplicateCodes(entries: { code: string; label: string; path: string }[]): string[] {
  const byCode = new Map<string, string[]>();
  for (const entry of entries) {
    byCode.set(entry.code, [...(byCode.get(entry.code) ?? []), `${entry.label} (${entry.path})`]);
  }
  return [...byCode.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([code, owners]) => `${code}: ${owners.join(" / ")}`);
}

/** L1 — no two rail items share a collapsed code; the message names each collision. */
export function givesEveryRailItemAUniqueCode(): void {
  const duplicates = duplicateCodes(collapsedRailEntries());
  expect(duplicates, `duplicate collapsed codes:\n${duplicates.join("\n")}`).toEqual([]);
}

/** L2 — the gate reads the full list: 23 items today, hidden ones included. */
export function readsTheFullItemList(): void {
  expect(collapsedRailEntries().length).toBeGreaterThanOrEqual(23);
}

/** L3 — every override key is the path of some rail item (a renamed key is dead). */
export function keysEveryOverrideByARealPath(): void {
  const paths = new Set(collapsedRailEntries().map((entry) => entry.path));
  const dead = Object.keys(COLLAPSED_LABEL_OVERRIDES).filter((key) => !paths.has(key));
  expect(dead).toEqual([]);
}

/** L4 — collapsed, every sidebar link's `aria-label` is "<title> (<visible code>)". */
export function labelsEveryCollapsedLinkWithItsTitleAndCode(): void {
  renderCollapsedShell();
  const links = sidebarLinks();
  expect(links.length).toBeGreaterThan(0);
  expect(links.map((link) => link.getAttribute("aria-label"))).toEqual(
    links.map((link) => `${link.getAttribute("title") ?? ""} (${link.textContent ?? ""})`),
  );
}

/** L5 — collapsed, "Dashboard (D)" and "Dashboards (DS)" each name exactly one link. */
export function namesDashboardAndDashboardsApartWhenCollapsed(): void {
  renderCollapsedShell();
  expect({
    Dashboard: within(sidebar()).queryAllByRole("link", { name: "Dashboard (D)" }).length,
    Dashboards: within(sidebar()).queryAllByRole("link", { name: "Dashboards (DS)" }).length,
  }).toEqual({ Dashboard: 1, Dashboards: 1 });
}

/** L6a — collapsed, the visible codes are unique. */
export function showsUniqueCodesWhenCollapsed(): void {
  renderCollapsedShell();
  const codes = sidebarLinks().map((link) => link.textContent ?? "");
  const repeated = codes.filter((code, index) => codes.indexOf(code) !== index);
  expect(codes.length).toBeGreaterThan(0);
  expect(repeated).toEqual([]);
}

/** L6b — collapsed, "Dashboards" reads "DS". */
export function showsDsForDashboardsWhenCollapsed(): void {
  renderCollapsedShell();
  expect(within(sidebar()).getByRole("link", { name: "Dashboards (DS)" })).toHaveTextContent(
    /^DS$/,
  );
}

/** L7 — expanded, "Dashboards" reads its full label. */
export function showsTheFullLabelWhenExpanded(): void {
  renderShell(GLOBAL, "/", "admin");
  expect(within(sidebar()).getByRole("link", { name: "Dashboards" })).toHaveTextContent(
    /^Dashboards$/,
  );
}

/**
 * L8 — collapsed, every link's accessible name contains its visible text (WCAG
 * 2.5.3). The name is the one Testing Library computes, read through the
 * `name` callback, so it is the name a query by role would match on.
 */
export function keepsTheVisibleCodeInEveryCollapsedName(): void {
  renderCollapsedShell();
  const names = new Map<HTMLElement, string>();
  within(sidebar()).getAllByRole("link", {
    name: (name, element) => {
      names.set(element as HTMLElement, name);
      return true;
    },
  });
  const missing = [...names.entries()]
    .filter(([link, name]) => !name.includes(link.textContent ?? " "))
    .map(([link, name]) => `"${name}" lacks "${link.textContent ?? ""}"`);
  expect(names.size).toBeGreaterThan(0);
  expect(missing).toEqual([]);
}

/** L9 — expanded, the "Dashboards" link's accessible name is exactly "Dashboards". */
export function namesTheExpandedLinkByItsLabel(): void {
  renderShell(GLOBAL, "/", "admin");
  expect(within(sidebar()).getByRole("link", { name: "Dashboards" })).toHaveAccessibleName(
    "Dashboards",
  );
}

/**
 * `F4.162` S9 (plan D7) — an `organization_admin` has no *Location Types*
 * entry. *Asset Groups* is the positive control: the Administration group
 * rendered for this role.
 */
export function hidesLocationTypesFromAnOrganizationAdmin(): void {
  renderShell(GLOBAL);
  expect(within(sidebar()).getByRole("link", { name: "Asset Groups" })).toBeInTheDocument();
  expect(within(sidebar()).queryAllByRole("link", { name: "Location Types" })).toHaveLength(0);
}

/** `F4.162` S10 — the global `admin` has one, pointing at `/admin/location-types`. */
export function showsLocationTypesToTheGlobalAdmin(): void {
  renderShell(GLOBAL, "/", "admin");
  const links = within(sidebar()).queryAllByRole("link", { name: "Location Types" });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute("href", "/admin/location-types");
}

/**
 * `F3.65c` U10 — the Light / Dark switch sits in the header's user area, between the user block
 * and the Logout button, and paints with the `on-dark` shapes `tests/f3.65a-colour-contrast.test.ts`
 * declares on `chrome` (constant-dark in both themes, so never `ink`).
 */
function header(): HTMLElement {
  return screen.getByRole("banner");
}

function themeGroup(): HTMLElement {
  return within(header()).getByRole("group", { name: "Theme" });
}

function follows(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** S15a — the switch follows the user block in the header. */
export function placesTheSwitchAfterTheUserBlock(): void {
  renderShell(GLOBAL, "/", "operator");
  const userName = within(header()).getByText("operator", { selector: "div" });
  expect(follows(userName, themeGroup())).toBe(true);
}

/** S15b — the switch precedes the Logout button in the header. */
export function placesTheSwitchBeforeLogout(): void {
  renderShell(GLOBAL, "/", "operator");
  const logout = within(header()).getByRole("button", { name: "Logout" });
  expect(follows(themeGroup(), logout)).toBe(true);
}

/** S16a — the pressed button carries the `on-dark` on an `on-dark/15` wash pair. */
export function drawsThePressedThemeButtonOnTheWash(): void {
  useThemeStore.setState({ theme: "light" });
  renderShell(GLOBAL, "/", "operator");
  const classes = within(themeGroup()).getByRole("button", { name: "Light" }).classList;
  expect([classes.contains("bg-on-dark/15"), classes.contains("text-on-dark")]).toEqual([true, true]);
}

/** S16b — the idle button carries `text-on-dark/85`, the Logout button's declared shape. */
export function drawsTheIdleThemeButtonAtEightyFive(): void {
  useThemeStore.setState({ theme: "light" });
  renderShell(GLOBAL, "/", "operator");
  const classes = within(themeGroup()).getByRole("button", { name: "Dark" }).classList;
  expect(classes.contains("text-on-dark/85")).toBe(true);
}
