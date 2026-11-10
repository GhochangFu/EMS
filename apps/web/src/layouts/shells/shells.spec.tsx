import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope, DesignSystem, UserRole } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { useThemeStore } from "../../stores/theme-store";
import { AppShell } from "../app-shell";

/**
 * `F4.341` PR 5 (ADR 0118 decision 6, plan D7) — the rail shell renders the sidebar's navigation
 * model: the same items in the same order under the same visibility rules, the selected item marked
 * `aria-current="page"`, the wordmark and logout present, and every rail item labelled in text (no
 * hover-only label). The sidebar's own cases stay in `app-shell.spec.tsx`.
 *
 * `F4.346` (ADR 0118 Amendment 3 decision 1, plan S2) — two shells: every design system lists its
 * module and administration items as links in one vertical `nav[aria-label="Modules"]`, with no
 * sideways scroller for the navigation.
 */
const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };
const NONE: AccessibleScope = { kind: "none", locations: [], assetGroups: [], assetIds: [] };

function renderAs(design: DesignSystem, role: UserRole, path: string, scope: AccessibleScope = GLOBAL): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  useAuthStore.setState({ scope });
  useThemeStore.getState().setDesign(design);
  const user = { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell user={user} kpiRibbon={<span />}>
          body
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The module links the shell shows, in order, as `label → href`. */
function moduleLinks(): string[] {
  return within(screen.getByRole("navigation", { name: "Modules" }))
    .getAllByRole("link")
    .map((a) => `${a.getAttribute("title") ?? a.textContent} → ${a.getAttribute("href")}`)
    .filter((entry) => !/^(Overview|Sites|Energy|Settings) → /.test(entry));
}

function linksFor(design: DesignSystem, role: UserRole, scope: AccessibleScope = GLOBAL): string[] {
  renderAs(design, role, "/alarms", scope);
  const links = moduleLinks().map((e) => e.replace(/^(.*?) → /, (_m, label: string) => `${label.trim()} → `));
  return links;
}

export function theOtherShellsListTheSidebarsItemsInOrder(cleanup: () => void): void {
  for (const role of ["admin", "operator", "location_admin"] as UserRole[]) {
    for (const scope of [GLOBAL, NONE]) {
      const sidebar = linksFor("nexus-soft", role, scope);
      cleanup();
      for (const design of ["enterprise-flat", "swiss-grid", "bento-ops", "control-room-dark"] as DesignSystem[]) {
        expect(linksFor(design, role, scope), `${design} ${role} ${scope.kind}`).toEqual(sidebar);
        cleanup();
      }
    }
  }
}

export function theSelectedItemIsAriaCurrent(design: DesignSystem): void {
  renderAs(design, "admin", "/alarms");
  const nav = screen.getByRole("navigation", { name: "Modules" });
  const current = within(nav).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
  expect(current.map((a) => a.textContent)).toEqual(["Alarm Centre"]);
}

export function theWordmarkAndLogoutAreThere(design: DesignSystem): void {
  // F4.347 — below `xl` the rail folds Logout into its header menu (`header-menu.spec.tsx`).
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1440 });
  renderAs(design, "operator", "/");
  expect(screen.getByRole("img", { name: "IONSiTE NEXUS" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();
}

export function everyRailItemHasAVisibleTextLabel(): void {
  renderAs("control-room-dark", "admin", "/");
  const nav = screen.getByRole("navigation", { name: "Modules" });
  const links = within(nav).getAllByRole("link");
  expect(links.length).toBeGreaterThan(10);
  for (const a of links) {
    expect((a.textContent ?? "").trim().length, a.getAttribute("href") ?? "").toBeGreaterThan(2);
    expect(a.className).not.toMatch(/\bhidden\b|group-hover|sr-only|text-3xs|text-2xs/);
  }
  expect(nav.className + (nav.parentElement?.className ?? "")).toMatch(/\btext-xs\b/);
  expect(screen.getByTestId("rail-status-strip")).toBeInTheDocument();
}

/** The labels of every visible module and administration item, for an `admin` with a global scope. */
const ADMIN_ITEMS = [
  "Alarm Centre",
  "Control Room",
  "Alarm Philosophy",
  "Dashboards",
  "Sustainability",
  "Assets",
  "Sites Map",
  "Energy Analytics",
  "Maintenance",
  "Schedule Centre",
  "Rule Engine",
  "Reports",
  "Master Data Hub",
];

/**
 * S2 — at a 1440 px viewport, every visible module and administration item is a link inside the one
 * `nav[aria-label="Modules"]`, its lists are vertical (no `flex` row) and nothing in the shell
 * outside the page body scrolls sideways.
 */
export function everyItemIsInOneVerticalModulesNav(design: DesignSystem): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1440 });
  renderAs(design, "admin", "/alarms");
  const navs = screen.getAllByRole("navigation", { name: "Modules" });
  expect(navs).toHaveLength(1);
  const nav = navs[0]!;
  const names = within(nav)
    .getAllByRole("link")
    .map((a) => a.getAttribute("title") ?? a.textContent ?? "");
  for (const label of ADMIN_ITEMS) expect(names, `${design} ${label}`).toContain(label);
  // F4.348 (I2): expanded, every item shows its decorative icon before its text label.
  for (const link of within(nav).getAllByRole("link")) {
    expect(link.firstElementChild?.matches('svg.nav-icon[aria-hidden="true"]'), `${design} ${link.textContent}`).toBe(true);
    expect((link.textContent ?? "").trim().length, `${design} ${link.getAttribute("href")}`).toBeGreaterThan(0);
  }
  for (const list of nav.querySelectorAll("ul")) expect(list.className, design).not.toMatch(/\bflex\b/);
  const main = screen.getByRole("main");
  const scrollers = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
    (el) => !main.contains(el) && /\boverflow-x-(auto|scroll)\b|\bw-max\b/.test(el.getAttribute("class") ?? ""),
  );
  expect(scrollers.map((el) => el.outerHTML.slice(0, 80)), design).toEqual([]);
}
