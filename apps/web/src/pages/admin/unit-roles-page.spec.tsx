import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AssetRolesListResponse } from "@bms/shared";

import * as api from "../../api/admin/asset-roles";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { useWizardStore } from "../../stores/wizard-store";
import { UnitRolesAdminPage } from "./unit-roles-page";

/**
 * `F4.282` (ADR 0099 Amendment 8 Q17) — the Unit Roles admin page, rendered
 * (ADR 0042). Assertions live here; `unit-roles-page.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * Every function of `api/admin/asset-roles` is stubbed, and so are the two
 * reads the `MasterDataLayout` → `AppShell` chrome issues (an unstubbed read
 * reaches a local API on `:4000`).
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const organizationAdmin = {
  id: "u2",
  email: "phe-admin@bms.local",
  displayName: "Org Admin",
  role: "organization_admin",
} as unknown as AuthUser;

/** Two rows, not seeded codes, with sort orders that equal nothing else on screen. */
const CATALOG: AssetRolesListResponse = {
  items: [
    { code: "f4282-active", label: "Spec active", sortOrder: 710, active: true },
    { code: "f4282-retired", label: "Spec retired", sortOrder: 720, active: false },
  ],
};
const [ACTIVE, RETIRED] = CATALOG.items as [(typeof CATALOG.items)[number], (typeof CATALOG.items)[number]];

function renderPage(as: AuthUser): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(api, "fetchAssetRoleCatalog").mockResolvedValue(CATALOG);
  vi.spyOn(api, "createAssetRole").mockResolvedValue(ACTIVE);
  vi.spyOn(api, "updateAssetRole").mockResolvedValue(ACTIVE);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/unit-roles"]}>
        <UnitRolesAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rowOf(code: string): Promise<HTMLElement> {
  const row = (await screen.findByText(code)).closest("tr");
  if (!row) throw new Error(`no row for ${code}`);
  return row;
}

/** One row per role, with its label, sort order and status. */
export async function rendersOneRowPerRole(): Promise<void> {
  renderPage(admin);
  const active = await rowOf(ACTIVE.code);
  expect(within(active).getByText(ACTIVE.label)).toBeInTheDocument();
  expect(within(active).getByText(String(ACTIVE.sortOrder))).toBeInTheDocument();
  expect(within(active).getByText("Active")).toBeInTheDocument();
  expect(within(await rowOf(RETIRED.code)).getByText("Inactive")).toBeInTheDocument();
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(CATALOG.items.length + 1);
}

/** Edit walks Role → Review and sends the label and sort order, with no `active` key. */
export async function editSendsLabelAndSortOrderOnly(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await user.click(within(await rowOf(ACTIVE.code)).getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit a unit role" });
  expect(within(dialog).queryByLabelText(/active/i)).toBeNull();
  const label = within(dialog).getByLabelText("Label");
  await user.clear(label);
  await user.type(label, "Spec renamed");
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  await user.click(await within(dialog).findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(api.updateAssetRole).toHaveBeenCalledTimes(1));
  expect(api.updateAssetRole).toHaveBeenCalledWith(ACTIVE.code, { label: "Spec renamed", sortOrder: ACTIVE.sortOrder });
}

/** A copilot fill of the sort order shows in the input, the value Submit then sends. Mutation: bind the input to the typed text alone. */
export async function aSortOrderFillShowsInTheEditInput(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await user.click(within(await rowOf(ACTIVE.code)).getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit a unit role" });
  act(() =>
    useWizardStore
      .getState()
      .receiveFill({ catalogId: "assetRole.update", params: { code: ACTIVE.code }, stepId: "role", values: { sortOrder: 40 } }, null),
  );
  await waitFor(() => expect((within(dialog).getByLabelText("Sort order") as HTMLInputElement).value).toBe("40"));
}

/** Deactivate is a Review-only dialog whose sentence names the role, and Submit sends `{ active: false }`. */
export async function deactivateSendsActiveFalse(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await user.click(within(await rowOf(ACTIVE.code)).getByRole("button", { name: "Deactivate" }));
  const dialog = await screen.findByRole("dialog", { name: "Deactivate a unit role" });
  expect(dialog.textContent).toContain(`Deactivate the fleet-wide unit role "${ACTIVE.label}" (${ACTIVE.code})`);
  expect(within(dialog).queryByRole("button", { name: "Next" })).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(api.updateAssetRole).toHaveBeenCalledTimes(1));
  expect(api.updateAssetRole).toHaveBeenCalledWith(ACTIVE.code, { active: false });
}

/** Reactivate on a retired row sends `{ active: true }`. */
export async function reactivateSendsActiveTrue(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await user.click(within(await rowOf(RETIRED.code)).getByRole("button", { name: "Reactivate" }));
  const dialog = await screen.findByRole("dialog", { name: "Reactivate a unit role" });
  await user.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(api.updateAssetRole).toHaveBeenCalledTimes(1));
  expect(api.updateAssetRole).toHaveBeenCalledWith(RETIRED.code, { active: true });
}

/** "Add a unit role" opens the create wizard. */
export async function addOpensTheCreateWizard(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await rowOf(ACTIVE.code);
  await user.click(screen.getByRole("button", { name: "Add a unit role" }));
  expect(await screen.findByRole("dialog", { name: "Add a unit role" })).toBeInTheDocument();
}

/** F4.204 — a refused write shows the sentence, not the envelope. */
export async function aRefusedWriteShowsTheSentence(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  vi.mocked(api.updateAssetRole).mockRejectedValue(
    new ApiError('{"statusCode":409,"message":"That unit role is in use","error":"Conflict"}', 409),
  );
  await user.click(within(await rowOf(ACTIVE.code)).getByRole("button", { name: "Deactivate" }));
  await user.click(await screen.findByRole("button", { name: "Submit" }));
  const banner = await screen.findByText(/That unit role is in use/);
  expect(banner.textContent).not.toContain('{"');
}

/** The page fails closed: an `organization_admin` sees the status line and the catalog read never starts. */
export async function failsClosedForAnOrganizationAdmin(): Promise<void> {
  renderPage(organizationAdmin);
  expect(screen.getByText("Unit roles are managed by a global administrator.")).toBeInTheDocument();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByRole("table")).toBeNull();
  expect(api.fetchAssetRoleCatalog).toHaveBeenCalledTimes(0);
}
