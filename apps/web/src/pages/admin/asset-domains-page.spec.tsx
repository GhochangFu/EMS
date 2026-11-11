import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminAssetDomainsListResponse } from "@bms/shared";

import * as api from "../../api/admin/asset-domains";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { AssetDomainsAdminPage } from "./asset-domains-page";

/**
 * `E3.1` (ADR 0122 decision 2.4, rulings P8 and R4) — the Asset Domains admin screen,
 * rendered (ADR 0042). Assertions live here; `asset-domains-page.test.tsx` is the
 * Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * Every read the page and its `MasterDataLayout` chrome issue is stubbed with
 * `vi.spyOn` (`F4.160`).
 */

const asUser = (role: string): AuthUser =>
  ({ id: "u1", email: `${role}@bms.local`, displayName: role, role }) as unknown as AuthUser;

const admin = asUser("admin");

/** Fixture codes, so a code found on screen came from the DTO. */
const DOMAINS: AdminAssetDomainsListResponse = {
  items: [
    { code: "e31_power", label: "Spec power", sortOrder: 10, active: true, workOrderPrefix: "PWR" },
    { code: "e31_bare", label: "Spec bare", sortOrder: 20, active: true, workOrderPrefix: null },
    { code: "e31_old", label: "Spec old", sortOrder: 30, active: false, workOrderPrefix: "OLD" },
  ],
};

function stubAll(): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(api, "fetchAdminAssetDomains").mockResolvedValue(DOMAINS);
  vi.spyOn(api, "updateAssetDomainPrefix").mockResolvedValue(DOMAINS.items[0] as never);
}

function renderPage(as: AuthUser): void {
  stubAll();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/asset-domains"]}>
        <AssetDomainsAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rowOf(code: string): Promise<HTMLElement> {
  const cell = await screen.findByText(code);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${code}`);
  return row;
}

/** A1 — a role other than `admin` sees the status sentence and nothing is fetched. */
export async function failsClosedForEveryOtherRole(): Promise<void> {
  for (const role of ["organization_admin", "location_admin"]) {
    vi.restoreAllMocks();
    renderPage(asUser(role));
    expect(screen.getByText("Asset domains are managed by a global administrator.")).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("table")).toBeNull();
    expect(api.fetchAdminAssetDomains).toHaveBeenCalledTimes(0);
    document.body.innerHTML = "";
  }
}

/** A2 — the admin sees every domain with its code, status and prefix, and the hint for a bare one. */
export async function rendersEachDomainWithItsPrefix(): Promise<void> {
  renderPage(admin);
  const power = await rowOf("e31_power");
  expect(within(power).getByText("Spec power")).toBeInTheDocument();
  expect(within(power).getByText("Active")).toBeInTheDocument();
  expect(within(power).getByLabelText("Work-order prefix for Spec power")).toHaveValue("PWR");
  const bare = await rowOf("e31_bare");
  expect(within(bare).getByLabelText("Work-order prefix for Spec bare")).toHaveValue("");
  expect(within(bare).getByText("Tickets read GEN-…")).toBeInTheDocument();
  const old = await rowOf("e31_old");
  expect(within(old).getByText("Retired")).toBeInTheDocument();
  expect(screen.getByText(/A new prefix applies to work orders created from now on/)).toBeInTheDocument();
}

/** A3 — typing lower case is upper-cased. */
export async function upperCasesWhatIsTyped(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const row = await rowOf("e31_bare");
  const input = within(row).getByLabelText("Work-order prefix for Spec bare");
  await user.type(input, "abc1");
  expect(input).toHaveValue("ABC1");
}

/** A4 — an invalid prefix keeps Save disabled and shows the hint; an unchanged row's Save is disabled. */
export async function aBadPrefixKeepsSaveDisabled(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const row = await rowOf("e31_bare");
  expect(within(row).getByRole("button", { name: "Save" })).toBeDisabled();
  await user.type(within(row).getByLabelText("Work-order prefix for Spec bare"), "x");
  expect(within(row).getByText("Two to eight capital letters or digits.")).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Save" })).toBeDisabled();
}

/** A5 — Save sends the new prefix. */
export async function saveSendsTheNewPrefix(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const row = await rowOf("e31_bare");
  await user.type(within(row).getByLabelText("Work-order prefix for Spec bare"), "bar");
  await user.click(within(row).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.updateAssetDomainPrefix).toHaveBeenCalledTimes(1));
  expect(api.updateAssetDomainPrefix).toHaveBeenCalledWith("e31_bare", "BAR");
}

/** A6 — clearing the field sends `null`. */
export async function clearingSendsNull(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const row = await rowOf("e31_power");
  await user.clear(within(row).getByLabelText("Work-order prefix for Spec power"));
  await user.click(within(row).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.updateAssetDomainPrefix).toHaveBeenCalledTimes(1));
  expect(api.updateAssetDomainPrefix).toHaveBeenCalledWith("e31_power", null);
}

/** A7 — a refusal shows the server's sentence, not the envelope. */
export async function aRefusalShowsTheSentence(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  vi.mocked(api.updateAssetDomainPrefix).mockImplementation(() =>
    Promise.reject(new ApiError('{"statusCode":409,"message":"That prefix is taken","error":"Conflict"}', 409)),
  );
  const row = await rowOf("e31_bare");
  await user.type(within(row).getByLabelText("Work-order prefix for Spec bare"), "BAR");
  await user.click(within(row).getByRole("button", { name: "Save" }));
  const banner = await within(row).findByRole("alert");
  expect(banner.textContent).toBe("That prefix is taken");
}
