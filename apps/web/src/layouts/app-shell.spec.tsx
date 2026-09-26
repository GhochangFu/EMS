import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope, UserRole } from "@bms/shared";

import * as assetsApi from "../api/assets";
import * as systemStatusApi from "../api/system-status";
import { OPERATIONAL } from "../components/system-status-indicator.spec";
import { useAuthStore, type AuthUser } from "../stores/auth-store";
import { AppShell } from "./app-shell";

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
 * entry. The shell no longer observes `["assets"]` — `ControlRoomRoute`
 * alone does, on the `/cr-*` routes — so the shell issues no `fetchAssets()`.
 * The entry highlights for `/control-room` and every `/control-room/*` path;
 * every other item keeps its exact-match highlight.
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

function renderShell(scope: AccessibleScope | null, path = "/"): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  useAuthStore.setState({ scope });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppShell user={asUser("organization_admin")} kpiRibbon={<span />}>
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
  expect(link?.classList.contains("border-bms-green")).toBe(true);
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
