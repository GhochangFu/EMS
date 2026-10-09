import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminLocationDto } from "@bms/shared";

import * as locationsApi from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import type { AuthUser } from "../../stores/auth-store";
import { HierarchyFilterBar, type HierarchySelection } from "./hierarchy-filter-bar";

/**
 * `F2.10` (ADR 0098 B5) — the location select lists the tree depth-first, one `— ` per level,
 * and any node is selectable. Assertions live here; `hierarchy-filter-bar.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock.
 */

const ORG_ID = "33333333-3333-3333-3333-333333333333";
const ROOT_ID = "10000000-0000-0000-0000-000000000001";
const CHILD_ID = "10000000-0000-0000-0000-000000000002";
const SIBLING_ID = "10000000-0000-0000-0000-000000000003";
const ORPHAN_ID = "10000000-0000-0000-0000-000000000004";

const user: AuthUser = {
  id: "u1",
  email: "org-admin@bms.local",
  displayName: "Org admin",
  role: "organization_admin",
} as unknown as AuthUser;

function location(id: string, name: string, parentId: string | null): AdminLocationDto {
  return {
    id,
    parentId,
    organizationId: ORG_ID,
    organizationCode: "F210",
    organizationName: "F2.10 org",
    code: name.toUpperCase(),
    slug: name.toLowerCase(),
    name,
    type: "site",
    typeLabel: "Site",
    province: null,
    capital: null,
    timezone: null,
    latitude: 0,
    longitude: 0,
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/** The API's name order: Child, Root, Sibling — the child must still follow its parent. */
const TREE = [
  location(CHILD_ID, "Child", ROOT_ID),
  location(ROOT_ID, "Root", null),
  location(SIBLING_ID, "Sibling", null),
];

function PathProbe() {
  const { pathname } = useLocation();
  return <p data-testid="path">{pathname}</p>;
}

function stubApi(items: AdminLocationDto[]): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("a spec reached the network"))));
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items });
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [
      { id: ORG_ID, code: "F210", name: "F2.10 org", active: true, meta: null, createdAt: new Date(0).toISOString() },
    ],
  } as never);
}

function renderBar(onNavigate: (s: HierarchySelection) => void, syncRoutes = true): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/start"]}>
        <HierarchyFilterBar
          user={user}
          levels={["organization", "location"]}
          selection={{ organizationId: ORG_ID }}
          onNavigate={onNavigate}
          syncRoutes={syncRoutes}
        />
        <Routes>
          <Route path="*" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The location select, found by its placeholder option, once the tree has loaded. */
async function locationSelect(firstName: string): Promise<HTMLSelectElement> {
  const placeholder = await screen.findByRole("option", { name: "Select location" });
  const select = placeholder.closest("select") as HTMLSelectElement;
  await within(select).findByRole("option", { name: firstName });
  return select;
}

/** H1 — depth-first, the child right after its parent and labelled `— Child`. */
export async function optionsAreDepthFirstWithTheChildIndented(): Promise<void> {
  stubApi(TREE);
  renderBar(vi.fn());
  const select = await locationSelect("Root");
  const labels = within(select)
    .getAllByRole("option")
    .map((o) => o.textContent);
  expect(labels).toEqual(["Select location", "Root", "— Child", "Sibling"]);
}

/** H2 — an interior node is selectable and syncs the route to its RTUs. */
export async function anInteriorNodeIsSelectableAndSyncsTheRoute(): Promise<void> {
  stubApi(TREE);
  const onNavigate = vi.fn();
  renderBar(onNavigate);
  const select = await locationSelect("Root");
  await userEvent.selectOptions(select, ROOT_ID);
  expect(onNavigate).toHaveBeenCalledWith({
    organizationId: ORG_ID,
    locationId: ROOT_ID,
    rtuId: undefined,
    assetId: undefined,
  });
  await waitFor(() => {
    expect(screen.getByTestId("path").textContent).toBe(`/admin/locations/${ROOT_ID}/rtus`);
  });
}

/** H3 — a node whose parent is not in the list is offered at depth 0. */
export async function anOrphanIsOfferedAtDepthZero(): Promise<void> {
  stubApi([location(ORPHAN_ID, "Orphan", "99999999-9999-9999-9999-999999999999")]);
  renderBar(vi.fn());
  const select = await locationSelect("Orphan");
  expect(within(select).queryByRole("option", { name: /— Orphan/ })).toBeNull();
}

/** H4 — `syncRoutes={false}` reports the choice and leaves the route alone. */
export async function syncRoutesFalseLeavesThePathUnchanged(): Promise<void> {
  stubApi(TREE);
  const onNavigate = vi.fn();
  renderBar(onNavigate, false);
  const select = await locationSelect("Root");
  await userEvent.selectOptions(select, CHILD_ID);
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("path").textContent).toBe("/start");
}
