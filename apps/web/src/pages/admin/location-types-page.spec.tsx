import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminLocationTypesListResponse } from "@bms/shared";

import * as api from "../../api/admin/location-types";
import * as systemStatusApi from "../../api/system-status";
import { ApiError } from "../../lib/api-error";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import { LocationTypesAdminPage } from "./location-types-page";

/**
 * `F4.162` U4 (ADR 0077 Amendment 1, plan D6/D7) — the Location Types admin
 * screen, rendered (ADR 0042). Assertions live here;
 * `location-types-page.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock.
 *
 * Every function of `api/admin/location-types` is stubbed with `vi.spyOn`, and
 * so is `fetchSystemStatus`, the one read the `MasterDataLayout` → `AppShell`
 * chrome issues (`F4.160`: an unstubbed read reaches a local API on `:4000`).
 * `AdminBreadcrumb`'s four reads are `enabled` only by route params, and this
 * page's route has none.
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const organizationAdmin: AuthUser = {
  id: "u2",
  email: "phe-admin@bms.local",
  displayName: "Org Admin",
  role: "organization_admin",
} as unknown as AuthUser;

/**
 * Two rows, deliberately not the seeded four, with counts (`17`, `23`) that
 * equal no sort order, so a count found on screen came from `locationCount`.
 */
const CATALOG: AdminLocationTypesListResponse = {
  items: [
    {
      code: "f4162_active",
      label: "Spec active",
      sortOrder: 10,
      active: true,
      createdAt: new Date(0).toISOString(),
      locationCount: 17,
    },
    {
      code: "f4162_retired",
      label: "Spec retired",
      sortOrder: 20,
      active: false,
      createdAt: new Date(0).toISOString(),
      locationCount: 23,
    },
  ],
};

const [ACTIVE, RETIRED] = CATALOG.items as [
  (typeof CATALOG.items)[number],
  (typeof CATALOG.items)[number],
];

function stubAll(): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(api, "fetchLocationTypeCatalog").mockResolvedValue(CATALOG);
  vi.spyOn(api, "createLocationType").mockResolvedValue(ACTIVE);
  vi.spyOn(api, "updateLocationType").mockResolvedValue(ACTIVE);
  vi.spyOn(api, "deactivateLocationType").mockResolvedValue({ ...ACTIVE, active: false });
  vi.spyOn(api, "reactivateLocationType").mockResolvedValue({ ...RETIRED, active: true });
}

function renderPage(as: AuthUser): void {
  stubAll();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/location-types"]}>
        <LocationTypesAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The `<tr>` that carries `code` in its Code cell. */
async function rowOf(code: string): Promise<HTMLElement> {
  const cell = await screen.findByText(code);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${code}`);
  return row;
}

/** W1 — one row per item, each showing its label, code and `locationCount`. */
export async function rendersOneRowPerItemWithItsCount(): Promise<void> {
  renderPage(admin);
  for (const item of CATALOG.items) {
    const row = await rowOf(item.code);
    expect(within(row).getByText(item.label)).toBeInTheDocument();
    expect(within(row).getByText(String(item.locationCount))).toBeInTheDocument();
  }
  const table = screen.getByRole("table");
  // A header row plus one per item.
  expect(within(table).getAllByRole("row")).toHaveLength(CATALOG.items.length + 1);
}

/** W2 — a retired row shows "Inactive" and offers "Reactivate". */
export async function showsARetiredRowAsInactiveWithReactivate(): Promise<void> {
  renderPage(admin);
  const row = await rowOf(RETIRED.code);
  expect(within(row).getByText("Inactive")).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
}

/** W3 — the create form posts `{ code, label, sortOrder }`. */
export async function createPostsCodeLabelAndSortOrder(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await rowOf(ACTIVE.code);
  await user.click(screen.getByRole("button", { name: "Add location type" }));
  await user.type(screen.getByLabelText("Code"), "f4162_new");
  await user.type(screen.getByLabelText("Label"), "Spec new");
  await user.type(screen.getByLabelText("Sort order"), "35");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.createLocationType).toHaveBeenCalledTimes(1));
  expect(api.createLocationType).toHaveBeenCalledWith({
    code: "f4162_new",
    label: "Spec new",
    sortOrder: 35,
  });
}

/** W4 — the edit form sends `{ label, sortOrder }` against the row's code, and **no `code`** in the body. */
export async function editSendsNoCodeInTheBody(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const row = await rowOf(ACTIVE.code);
  await user.click(within(row).getByRole("button", { name: "Edit" }));
  const label = screen.getByLabelText("Label");
  await user.clear(label);
  await user.type(label, "Spec renamed");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.updateLocationType).toHaveBeenCalledTimes(1));
  expect(api.updateLocationType).toHaveBeenCalledWith(ACTIVE.code, {
    label: "Spec renamed",
    sortOrder: ACTIVE.sortOrder,
  });
}

/** W5 — Deactivate on an active row calls `deactivateLocationType(code)`. */
export async function deactivateCallsDeactivateWithTheCode(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const row = await rowOf(ACTIVE.code);
  await user.click(within(row).getByRole("button", { name: "Deactivate" }));
  // Wait for EITHER toggle call, then assert which: a wait on the right one
  // alone would time out on the wrong one instead of failing on it.
  const toggles = (): number =>
    vi.mocked(api.deactivateLocationType).mock.calls.length +
    vi.mocked(api.reactivateLocationType).mock.calls.length;
  await waitFor(() => expect(toggles()).toBe(1));
  expect(api.deactivateLocationType).toHaveBeenCalledWith(ACTIVE.code);
}

/** W6 — D6: a save invalidates `["admin", "location-types"]`, the locations form's dropdown. */
export async function saveInvalidatesTheDropdownKey(): Promise<void> {
  const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  const user = userEvent.setup();
  renderPage(admin);
  const row = await rowOf(ACTIVE.code);
  await user.click(within(row).getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.updateLocationType).toHaveBeenCalledTimes(1));
  // The page's own key is the positive control that onSuccess ran; the
  // dropdown key is then asserted at once, so its absence fails here rather
  // than as a timeout.
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "location-types-catalog"] }),
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "location-types"] });
}

/**
 * W7 — D7: the page fails closed. An `organization_admin` reaching the URL
 * sees the status line, no table, and the catalog read is never issued. The
 * status line is the positive control that the page rendered; one macrotask
 * lets any mounted query start its fetch.
 */
export async function failsClosedForAnOrganizationAdmin(): Promise<void> {
  renderPage(organizationAdmin);
  expect(
    screen.getByText("Location types are managed by a global administrator."),
  ).toBeInTheDocument();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByRole("table")).toBeNull();
  expect(api.fetchLocationTypeCatalog).toHaveBeenCalledTimes(0);
}

/**
 * `F4.204` — an `ApiError` carries the whole response body, so a refusal read
 * through `err.message` showed `{"statusCode":409,…}`. Each site reads it through
 * `apiErrorMessage`; one case per site, because a site left on `err.message`
 * reddens only its own case. The sentence is found by text (the banner has no
 * role), and the element holding it must not also hold the envelope.
 */
const refusedWith = (sentence: string) => () =>
  Promise.reject(
    new ApiError(`{"statusCode":409,"message":"${sentence}","error":"Conflict"}`, 409),
  );

/** F4.204 — a refused save shows the sentence, not the envelope. */
export async function aRefusedSaveShowsTheSentence(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  vi.mocked(api.createLocationType).mockImplementation(
    refusedWith("A location type with that code already exists"),
  );
  await rowOf(ACTIVE.code);
  await user.click(screen.getByRole("button", { name: "Add location type" }));
  await user.type(screen.getByLabelText("Code"), "f4204_new");
  await user.type(screen.getByLabelText("Label"), "Spec new");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const banner = await screen.findByText(/A location type with that code already exists/);
  expect(banner.textContent).not.toContain('{"');
}

/** F4.204 — a refused Deactivate shows the sentence, not the envelope. */
export async function aRefusedToggleShowsTheSentence(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  vi.mocked(api.deactivateLocationType).mockImplementation(
    refusedWith("A location type in use cannot be deactivated"),
  );
  const row = await rowOf(ACTIVE.code);
  await user.click(within(row).getByRole("button", { name: "Deactivate" }));
  const banner = await screen.findByText(/A location type in use cannot be deactivated/);
  expect(banner.textContent).not.toContain('{"');
}
