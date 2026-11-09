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
 * `F4.341` PR 5 (ADR 0118 decision 6, plan D7) — the topbar and rail shells render the sidebar's
 * navigation model: the same items in the same order under the same visibility rules, the selected
 * item marked `aria-current="page"`, the wordmark and logout present, and every rail item labelled
 * in text (no hover-only label). The sidebar's own cases stay in `app-shell.spec.tsx`.
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
function moduleLinks(design: DesignSystem): string[] {
  const container = design === "nexus-soft" ? screen.getByRole("complementary") : screen.getByRole("navigation", { name: "Modules" });
  return within(container)
    .getAllByRole("link")
    .map((a) => `${a.getAttribute("title") ?? a.textContent} → ${a.getAttribute("href")}`)
    .filter((entry) => !/^(Overview|Sites|Energy|Settings) → /.test(entry));
}

function linksFor(design: DesignSystem, role: UserRole, scope: AccessibleScope = GLOBAL): string[] {
  renderAs(design, role, "/alarms", scope);
  const links = moduleLinks(design).map((e) => e.replace(/^(.*?) → /, (_m, label: string) => `${label.trim()} → `));
  return links;
}

export function theOtherShellsListTheSidebarsItemsInOrder(cleanup: () => void): void {
  for (const role of ["admin", "operator", "location_admin"] as UserRole[]) {
    for (const scope of [GLOBAL, NONE]) {
      const sidebar = linksFor("nexus-soft", role, scope);
      cleanup();
      for (const design of ["swiss-grid", "control-room-dark"] as DesignSystem[]) {
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
