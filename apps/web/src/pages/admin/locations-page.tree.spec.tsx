import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminLocationDto, MasterDataActiveFilter } from "@bms/shared";

import * as groupsApi from "../../api/admin/asset-groups";
import * as api from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import * as dashboardsApi from "../../api/dashboards";
import * as reportsApi from "../../api/reports";
import * as systemStatusApi from "../../api/system-status";
import { ApiError } from "../../lib/api-error";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { LocationsAdminPage } from "./locations-page";

/**
 * `F2.10` (ADR 0098 decisions 5, 12, B6, B8, B10, ruling 16) — the Locations admin page over
 * the tree: tree order, the Parent column, the parent pickers, the refusal sentences and the
 * move dialog. Assertions live here; `locations-page.tree.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock. The harness is `locations-page.spec.tsx`'s.
 */

const ORG = "33333333-3333-3333-3333-333333333333";
const R = "10000000-0000-0000-0000-000000000001";
const C = "10000000-0000-0000-0000-000000000002";
const G = "10000000-0000-0000-0000-000000000003";
const S = "10000000-0000-0000-0000-000000000004";
const I = "10000000-0000-0000-0000-000000000005";

function location(
  id: string,
  name: string,
  parentId: string | null,
  active = true,
): AdminLocationDto {
  return {
    id,
    parentId,
    organizationId: ORG,
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
    active,
    meta: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/** The API's name order. Tree: Root > Child > Grandchild; Root > Inactive; Sibling. */
const ALL = [
  location(C, "Child", R),
  location(G, "Grandchild", C),
  location(I, "Inactive", R, false),
  location(R, "Root", null),
  location(S, "Sibling", null),
];
const ACTIVE = ALL.filter((l) => l.active);
const byName = (name: string) => ALL.find((l) => l.name === name)!;

const FRESH_SCOPE = {
  kind: "global" as const,
  locations: [
    { id: R, code: "ROOT", slug: "root", name: "Root", type: "site", province: null, parentId: null },
  ],
  assetGroups: [],
  assetIds: [],
};

function userAs(role: AuthUser["role"]): AuthUser {
  return { id: "u1", email: "admin@bms.local", displayName: "Admin", role } as AuthUser;
}

/** Every network call is a stub; `fetch` answers `/auth/me` only (refreshScope, B8). */
function stubApi(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn((url: string) =>
    String(url).endsWith("/api/v1/auth/me")
      ? Promise.resolve(
          new Response(
            JSON.stringify({
              user: { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" },
              scope: FRESH_SCOPE,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )
      : Promise.reject(new Error(`a spec reached the network: ${String(url)}`)),
  );
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(api, "fetchAdminLocations").mockImplementation(
    async (active?: MasterDataActiveFilter, organizationId?: string) => ({
      items: active === "true" && organizationId === ORG ? ACTIVE : ALL,
    }),
  );
  vi.spyOn(api, "fetchAdminLocationTypes").mockResolvedValue({
    items: [{ code: "site", label: "Site" }],
  } as never);
  vi.spyOn(api, "createAdminLocation").mockResolvedValue(byName("Child"));
  vi.spyOn(api, "updateAdminLocation").mockResolvedValue(byName("Child"));
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [
      { id: ORG, code: "F210", name: "F2.10 org", active: true, meta: null, createdAt: new Date(0).toISOString() },
    ],
  } as never);
  vi.spyOn(api, "fetchSiteControlRoomView").mockResolvedValue({
    locationId: C,
    organizationId: ORG,
    kind: "generated",
    dashboardId: null,
    builtinKey: null,
    updatedAt: null,
    updatedBy: null,
  });
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({ items: [] });
  vi.spyOn(groupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [] });
  vi.spyOn(reportsApi, "fetchReportSchedules").mockResolvedValue([]);
  return fetchSpy;
}

function renderPage(role: AuthUser["role"] = "admin"): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocationsAdminPage user={userAs(role)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The Name column's index: Org, Code, Name. */
const NAME_CELL = 2;

/** The `<tr>` whose Name cell reads `name`, with or without the tree's dashes. */
async function rowOf(name: string): Promise<HTMLElement> {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    found = screen
      .getAllByRole("row")
      .find(
        (row) =>
          row.querySelectorAll("td")[NAME_CELL]?.textContent?.replace(/^(— )+/, "") === name,
      );
    expect(found).toBeDefined();
  });
  return found!;
}

async function openCreate(): Promise<void> {
  await rowOf("Root");
  await userEvent.click(screen.getByRole("button", { name: "Add location" }));
  await screen.findByRole("heading", { name: "Add location" });
  await userEvent.selectOptions(screen.getByLabelText("Organization"), ORG);
  await userEvent.type(screen.getByLabelText("code"), "NEW");
  await userEvent.type(screen.getByLabelText("slug"), "new");
  await userEvent.type(screen.getByLabelText("name"), "New node");
}

async function openEdit(name: string, role: AuthUser["role"] = "admin"): Promise<void> {
  stubApi();
  renderPage(role);
  await userEvent.click(within(await rowOf(name)).getByRole("button", { name: "Edit" }));
  await screen.findByRole("heading", { name: "Edit location" });
}

/** The Parent select, once its option `waitFor` has loaded. */
async function parentSelect(waitFor: string): Promise<HTMLSelectElement> {
  const select = screen.getByLabelText("Parent") as HTMLSelectElement;
  await within(select).findByRole("option", { name: waitFor });
  return select;
}

function optionLabels(select: HTMLSelectElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

/** P1 — the Parent column names the parent, and `—` for a root. */
export async function theParentColumnNamesTheParent(): Promise<void> {
  stubApi();
  renderPage();
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
  const parentIndex = headers.indexOf("Parent");
  expect(parentIndex).toBe(headers.indexOf("Name") + 1);
  expect(within(await rowOf("Child")).getAllByRole("cell")[parentIndex]!.textContent).toBe("Root");
  expect(within(await rowOf("Root")).getAllByRole("cell")[parentIndex]!.textContent).toBe("—");
}

/** P2 — rows are depth-first, siblings in the API's name order (B10). */
export async function rowsAreDepthFirst(): Promise<void> {
  stubApi();
  renderPage();
  await rowOf("Grandchild");
  const names = screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[NAME_CELL]!.textContent);
  expect(names).toEqual(["Root", "— Child", "— — Grandchild", "— Inactive", "Sibling"]);
}

/** P3 — a refused deactivate shows the server's sentence, not the raw body (decision 5). */
export async function aRefusedDeactivateShowsTheSentence(): Promise<void> {
  stubApi();
  vi.spyOn(api, "deactivateAdminLocation").mockRejectedValue(
    new ApiError(
      '{"statusCode":409,"message":"Cannot deactivate a location with active child locations","reason":"location_has_active_children"}',
      409,
    ),
  );
  renderPage();
  await userEvent.click(within(await rowOf("Root")).getByRole("button", { name: "Deactivate" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Cannot deactivate a location with active child locations");
  expect(alert.textContent).not.toContain('{"');
}

/** P4 — a refused reactivate shows its sentence too. */
export async function aRefusedReactivateShowsTheSentence(): Promise<void> {
  stubApi();
  vi.spyOn(api, "reactivateAdminLocation").mockRejectedValue(
    new ApiError(
      '{"statusCode":409,"message":"The parent location is inactive","reason":"location_parent_inactive"}',
      409,
    ),
  );
  renderPage();
  await userEvent.click(within(await rowOf("Inactive")).getByRole("button", { name: "Reactivate" }));
  expect((await screen.findByRole("alert")).textContent).toBe("The parent location is inactive");
}

/** P5 — an untouched create posts `parentId: null` (a root). */
export async function anUntouchedCreatePostsNoParent(): Promise<void> {
  stubApi();
  renderPage();
  await openCreate();
  await parentSelect("Sibling");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(api.createAdminLocation).toHaveBeenCalledTimes(1);
  });
  expect(vi.mocked(api.createAdminLocation).mock.calls[0]![0]).toHaveProperty("parentId", null);
}

/** P6 — picking a parent on create posts its id. */
export async function pickingAParentOnCreatePostsIt(): Promise<void> {
  stubApi();
  renderPage();
  await openCreate();
  await userEvent.selectOptions(await parentSelect("— Child"), C);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(api.createAdminLocation).toHaveBeenCalledTimes(1);
  });
  expect(vi.mocked(api.createAdminLocation).mock.calls[0]![0]).toHaveProperty("parentId", C);
}

/** P7 — the create Parent select offers no inactive node (a guaranteed 409). */
export async function theCreateParentSelectOffersNoInactiveNode(): Promise<void> {
  stubApi();
  renderPage();
  await openCreate();
  const labels = optionLabels(await parentSelect("Sibling"));
  expect(labels).toContain("Sibling");
  expect(labels.some((l) => l.includes("Inactive"))).toBe(false);
}

/** P8 — editing C as admin offers R and S, never C itself or its descendant G (B6). */
export async function theEditParentSelectExcludesTheSubtree(): Promise<void> {
  await openEdit("Child");
  const labels = optionLabels(await parentSelect("Sibling"));
  expect(labels).toEqual(["No parent (root)", "Root", "Sibling"]);
}

/** P9 — a location_admin sees the parent as text and gets no Parent control (decision 12). */
export async function aLocationAdminSeesTheParentAsText(): Promise<void> {
  await openEdit("Child", "location_admin");
  expect(screen.getByText("Parent: Root")).toBeTruthy();
  expect(screen.queryByLabelText("Parent")).toBeNull();
}

/** P9b — a location_admin's save sends no `parentId` key (any value is a 403). */
export async function aLocationAdminSaveSendsNoParentKey(): Promise<void> {
  await openEdit("Child", "location_admin");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(api.updateAdminLocation).toHaveBeenCalledTimes(1);
  });
  const body = vi.mocked(api.updateAdminLocation).mock.calls[0]![1];
  expect(body).toHaveProperty("name", "Child");
  expect(body).not.toHaveProperty("parentId");
}

/** P10 — an admin's save with the parent untouched sends no `parentId` key. */
export async function anUntouchedParentSendsNoParentKey(): Promise<void> {
  await openEdit("Child");
  await parentSelect("Sibling");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(api.updateAdminLocation).toHaveBeenCalledTimes(1);
  });
  const body = vi.mocked(api.updateAdminLocation).mock.calls[0]![1];
  expect(body).toHaveProperty("name");
  expect(body).not.toHaveProperty("parentId");
}

async function moveChildToSibling(): Promise<void> {
  await openEdit("Child");
  await userEvent.selectOptions(await parentSelect("Sibling"), S);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
}

/** P11 — a changed parent opens the move dialog instead of saving. */
export async function aChangedParentOpensTheDialog(): Promise<void> {
  await moveChildToSibling();
  expect(await screen.findByRole("dialog", { name: "Move Child under Sibling" })).toBeTruthy();
  expect(api.updateAdminLocation).not.toHaveBeenCalled();
}

/** P12 — Confirm sends the new parent with the rest of the body. */
export async function confirmSendsTheNewParent(): Promise<void> {
  await moveChildToSibling();
  const dialog = await screen.findByRole("dialog", { name: "Move Child under Sibling" });
  const move = within(dialog).getByRole("button", { name: "Move" }) as HTMLButtonElement;
  await waitFor(() => {
    expect(move.disabled).toBe(false);
  });
  await userEvent.click(move);
  await waitFor(() => {
    expect(api.updateAdminLocation).toHaveBeenCalledTimes(1);
  });
  const body = vi.mocked(api.updateAdminLocation).mock.calls[0]![1];
  expect(body).toHaveProperty("parentId", S);
  expect(body).toHaveProperty("name", "Child");
}

/** P13 — Cancel closes the dialog and sends nothing. */
export async function cancelSendsNothing(): Promise<void> {
  await moveChildToSibling();
  const dialog = await screen.findByRole("dialog", { name: "Move Child under Sibling" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  expect(api.updateAdminLocation).not.toHaveBeenCalled();
}

/** P14 — after a confirmed move, `/auth/me` is read and replaces the stored scope (B8). */
export async function aMoveRefreshesTheScope(): Promise<void> {
  useAuthStore.setState({ accessToken: "tok-p14", scope: null });
  await moveChildToSibling();
  const fetchSpy = vi.mocked(globalThis.fetch);
  const dialog = await screen.findByRole("dialog", { name: "Move Child under Sibling" });
  const move = within(dialog).getByRole("button", { name: "Move" }) as HTMLButtonElement;
  await waitFor(() => {
    expect(move.disabled).toBe(false);
  });
  await userEvent.click(move);
  await waitFor(() => {
    expect(JSON.stringify(useAuthStore.getState().scope)).toBe(JSON.stringify(FRESH_SCOPE));
  });
  const meCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/api/v1/auth/me"));
  expect(new Headers(meCall?.[1]?.headers).get("Authorization")).toBe("Bearer tok-p14");
}

/** P15 — a refused move shows the server's sentence in the form, which stays open. */
export async function aRefusedMoveShowsTheSentenceInTheForm(): Promise<void> {
  await moveChildToSibling();
  vi.mocked(api.updateAdminLocation).mockRejectedValue(
    new ApiError(
      '{"statusCode":400,"message":"A location tree may be at most 8 levels deep","reason":"location_depth_exceeded"}',
      400,
    ),
  );
  const dialog = await screen.findByRole("dialog", { name: "Move Child under Sibling" });
  const move = within(dialog).getByRole("button", { name: "Move" }) as HTMLButtonElement;
  await waitFor(() => {
    expect(move.disabled).toBe(false);
  });
  await userEvent.click(move);
  expect(
    await screen.findByText("A location tree may be at most 8 levels deep"),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Edit location" })).toBeTruthy();
}
