import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope, UserRole } from "@bms/shared";

import * as systemStatusApi from "../../api/system-status";
import { AdminHubPage } from "../../pages/admin/admin-hub-page";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { OPERATIONAL } from "../system-status-indicator.spec";
import { MasterDataLayout } from "./master-data-layout";

/**
 * `F3.76` — the Master Data chrome: area tabs, the selected area's sub-tabs,
 * and the hub landing page. Assertions live here; `master-data-layout.test.tsx`
 * is the Vitest entry point and carries the jsdom docblock (ADR 0014, ADR 0042
 * decision 2). `fetchSystemStatus` is stubbed: an unstubbed read reaches a
 * local API on `:4000` (`F4.160`).
 */

const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

function asUser(role: UserRole): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

function renderAt(path: string, role: UserRole, page: "layout" | "hub"): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  useAuthStore.setState({ scope: GLOBAL });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {page === "layout" ? (
          <MasterDataLayout user={asUser(role)}>
            <p>PAGE BODY</p>
          </MasterDataLayout>
        ) : (
          <AdminHubPage user={asUser(role)} />
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** "<name> <href>" for each link, with a trailing " *" on the one marked current. */
function links(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole("link")
    .map(
      (link) =>
        `${link.textContent ?? ""} ${link.getAttribute("href") ?? ""}${
          link.getAttribute("aria-current") === "page" ? " *" : ""
        }`,
    );
}

/** T1 — the area tabs: every area the global admin sees, Sites & Equipment current on a drill-down. */
export function marksTheAreaOfADrillDown(): void {
  renderAt("/admin/locations/l1/rtus/r1/assets", "admin", "layout");
  expect(links(screen.getByRole("navigation", { name: "Master data areas" }))).toEqual([
    "Sites & Equipment /admin/organizations *",
    "Reference Data /admin/asset-groups",
    "Templates & Visuals /admin/asset-templates",
    "Data Input /admin/manual-readings",
    "Notifications /admin/notification-channels",
    "Users & Access /admin/users",
  ]);
}

/** T2 — the sub-tabs of the selected area, the drill-down's deepest level current. */
export function marksTheDeepestLevelOfADrillDown(): void {
  renderAt("/admin/locations/l1/rtus/r1/assets", "admin", "layout");
  expect(links(screen.getByRole("navigation", { name: "Sites & Equipment" }))).toEqual([
    "Organizations /admin/organizations",
    "Locations /admin/locations",
    "RTUs /admin/rtus",
    "Assets /admin/assets *",
    "Asset Points /admin/asset-points",
  ]);
}

/** T3 — a `location_admin` sees four areas and only its own tabs of Reference Data. */
export function showsALocationAdminItsOwnTabs(): void {
  renderAt("/admin/calc-parameters", "location_admin", "layout");
  expect({
    areas: links(screen.getByRole("navigation", { name: "Master data areas" })).length,
    reference: links(screen.getByRole("navigation", { name: "Reference Data" })),
  }).toEqual({
    areas: 4,
    reference: ["Asset Groups /admin/asset-groups", "Calc Parameters /admin/calc-parameters *"],
  });
}

/** T4 — the ribbon names the selected area; the page body renders under the tabs. */
export function namesTheAreaInTheRibbon(): void {
  renderAt("/admin/notification-deliveries", "organization_admin", "layout");
  expect(screen.getByText("Administration · Notifications")).toBeInTheDocument();
  expect(screen.getByText("PAGE BODY")).toBeInTheDocument();
}

/** H1 — `/admin` renders the hub with one card per area; it no longer redirects. */
export function rendersOneCardPerArea(): void {
  renderAt("/admin", "admin", "hub");
  expect(screen.getByRole("heading", { level: 1, name: "Master Data Hub" })).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
    "Sites & Equipment",
    "Reference Data",
    "Templates & Visuals",
    "Data Input",
    "Notifications",
    "Users & Access",
  ]);
}

/** H2 — a card lists the area's screens as links. */
export function linksEveryScreenOfAnArea(): void {
  renderAt("/admin", "admin", "hub");
  expect(links(screen.getByRole("list", { name: "Notifications" }))).toEqual([
    "Channels /admin/notification-channels",
    "Escalation /admin/escalation-profiles",
    "Deliveries /admin/notification-deliveries",
  ]);
}

/** H3 — a `location_admin` gets no Notifications or Users & Access card; its other four cards stay. */
export function leavesOutAnAreaTheRoleCannotSee(): void {
  renderAt("/admin", "location_admin", "hub");
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
    "Sites & Equipment",
    "Reference Data",
    "Templates & Visuals",
    "Data Input",
  ]);
}
