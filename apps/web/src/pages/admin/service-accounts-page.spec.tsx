import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { ServiceAccountDto } from "@bms/shared";

import * as assetGroupsApi from "../../api/admin/asset-groups";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as api from "../../api/admin/service-accounts";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { visibleMasterDataTabs } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";
import {
  NO_SERVICE_ACCOUNTS,
  SERVICE_ACCOUNTS_REFUSED,
  SERVICE_TOKEN_SHOWN_ONCE,
  ServiceAccountsAdminPage,
} from "./service-accounts-page";

/**
 * `F4.17` (ADR 0125 decision 14) — the Service Accounts page: fails closed
 * below organization admin and is reachable from the Users & Access tabs for
 * exactly the two roles that may use it; a new token shows once, copies, and
 * is gone after the dialog closes; revoke and disable ask first; a full
 * account offers no new token. The API is spied.
 */

const orgAdmin = { id: "u2", email: "o@bms.local", displayName: "Org", role: "organization_admin" } as unknown as AuthUser;
const operator = { id: "u3", email: "op@bms.local", displayName: "Op", role: "operator" } as unknown as AuthUser;

const PHE = "00000000-0000-4000-8000-0000000000a1";
const LOC = "00000000-0000-4000-8000-0000000000b1";
const TOKEN = `bms_sat_ABCDEFGHIJKL_${"Q".repeat(43)}`;

const token = (id: string, tokenId: string, status: "active" | "revoked" | "expired" = "active") => ({
  id,
  tokenId,
  name: `token ${tokenId}`,
  readOnly: false,
  status,
  expiresAt: "2027-02-08T00:00:00.000Z",
  createdAt: "2026-11-10T00:00:00.000Z",
  revokedAt: status === "revoked" ? "2026-11-10T01:00:00.000Z" : null,
  lastUsedAt: null,
});

const SA1: ServiceAccountDto = {
  id: "00000000-0000-4000-8000-0000000000d1",
  organizationId: PHE,
  name: "SCADA bridge",
  role: "operator",
  disabledAt: null,
  createdAt: "2026-11-10T00:00:00.000Z",
  tokens: [token("00000000-0000-4000-8000-0000000000e1", "AAAAAAAAAAAA")],
  grants: [{ id: "00000000-0000-4000-8000-0000000000f1", kind: "location", targetId: LOC, targetName: "Lakwa plant" }],
};
const SA_FULL: ServiceAccountDto = {
  ...SA1,
  id: "00000000-0000-4000-8000-0000000000d2",
  name: "Historian",
  tokens: [token("00000000-0000-4000-8000-0000000000e2", "BBBBBBBBBBBB"), token("00000000-0000-4000-8000-0000000000e3", "CCCCCCCCCCCC")],
};

function renderPage(as: AuthUser, items: ServiceAccountDto[] = [SA1, SA_FULL]): QueryClient {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(api, "fetchServiceAccounts").mockResolvedValue({ items });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [{ id: PHE, code: "PHE", name: "PHE West Bengal" }] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [{ id: LOC, name: "Lakwa plant", organizationId: PHE }] } as never);
  vi.spyOn(assetGroupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [] } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/service-accounts"]}>
        <ServiceAccountsAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

async function cardOf(name: string): Promise<HTMLElement> {
  return screen.findByRole("article", { name: `Service account ${name}` });
}

/** S1 — an operator sees the status line and no read runs; the tab is the two manager roles' only. */
export async function belowOrganizationAdminIsRefusedAndHasNoTab(): Promise<void> {
  renderPage(operator);
  expect(await screen.findByRole("status")).toHaveTextContent(SERVICE_ACCOUNTS_REFUSED);
  expect(api.fetchServiceAccounts).not.toHaveBeenCalled();
  const has = (role: AuthUser["role"]) => visibleMasterDataTabs(role).some((tab) => tab.path === "/admin/service-accounts");
  expect(has("admin")).toBe(true);
  expect(has("organization_admin")).toBe(true);
  for (const role of ["location_admin", "asset_group_admin", "operator", "viewer"] as const) {
    expect(has(role), role).toBe(false);
  }
}

/** S2 — the accounts, their grants and tokens (the public id only); a full account offers no new token. */
export async function theAccountsTokensAndGrantsRender(): Promise<void> {
  renderPage(orgAdmin);
  const card = await cardOf("SCADA bridge");
  expect(within(card).getByText("Operator")).toBeInTheDocument();
  expect(within(card).getByText(/Grants: Lakwa plant/)).toBeInTheDocument();
  expect(within(card).getByText("bms_sat_AAAAAAAAAAAA_…")).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "New token" })).toBeEnabled();
  const full = await cardOf("Historian");
  expect(within(full).getByRole("button", { name: "New token" })).toBeDisabled();
}

/** S3 — a new token shows once, copies, and is gone after Done. */
export async function aNewTokenShowsOnce(): Promise<void> {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const issue = vi.spyOn(api, "createServiceToken").mockResolvedValue({ token: TOKEN, item: token("00000000-0000-4000-8000-0000000000e9", "ABCDEFGHIJKL") });
  renderPage(orgAdmin);
  await user.click(within(await cardOf("SCADA bridge")).getByRole("button", { name: "New token" }));
  const dialog = await screen.findByRole("dialog", { name: "New token for SCADA bridge" });
  await user.type(within(dialog).getByLabelText("Name"), "primary");
  await user.click(within(dialog).getByRole("button", { name: "Issue token" }));
  expect(await within(dialog).findByDisplayValue(TOKEN)).toBeInTheDocument();
  expect(within(dialog).getByText(SERVICE_TOKEN_SHOWN_ONCE)).toBeInTheDocument();
  expect(issue).toHaveBeenCalledWith(SA1.id, { name: "primary", expiresInDays: 90, readOnly: false });
  await user.click(within(dialog).getByRole("button", { name: "Copy token" }));
  expect(writeText).toHaveBeenCalledWith(TOKEN);
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.body.innerHTML).not.toContain(TOKEN);
}

/** S4 — revoke asks first, then revokes that token. */
export async function revokeAsksFirst(): Promise<void> {
  const user = userEvent.setup();
  const revoke = vi.spyOn(api, "revokeServiceToken").mockResolvedValue({ item: SA1 });
  renderPage(orgAdmin);
  await user.click(within(await cardOf("SCADA bridge")).getByRole("button", { name: "Revoke token AAAAAAAAAAAA" }));
  const dialog = await screen.findByRole("dialog", { name: "Revoke token" });
  expect(within(dialog).getByText(/Revocation is final/)).toBeInTheDocument();
  expect(revoke).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith(SA1.id, SA1.tokens[0]?.id));
}

/** S5 — disable asks first and says every token is revoked. */
export async function disableAsksFirst(): Promise<void> {
  const user = userEvent.setup();
  const update = vi.spyOn(api, "updateServiceAccount").mockResolvedValue({ item: { ...SA1, disabledAt: "2026-11-11T00:00:00.000Z" } });
  renderPage(orgAdmin);
  await user.click(within(await cardOf("SCADA bridge")).getByRole("button", { name: "Disable" }));
  const dialog = await screen.findByRole("dialog", { name: "Disable service account" });
  expect(within(dialog).getByText(/Every token it holds is revoked/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Disable" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(SA1.id, { disabled: true }));
}

/** S6 — create sends the organization, name and role; an empty list says so. */
export async function createSendsTheBodyAndEmptySaysSo(): Promise<void> {
  const user = userEvent.setup();
  const create = vi.spyOn(api, "createServiceAccount").mockResolvedValue({ item: SA1 });
  renderPage(orgAdmin, []);
  expect(await screen.findByText(NO_SERVICE_ACCOUNTS)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "New service account" }));
  const dialog = await screen.findByRole("dialog", { name: "New service account" });
  await within(dialog).findByRole("option", { name: "PHE — PHE West Bengal" });
  await user.selectOptions(within(dialog).getByLabelText("Organization"), PHE);
  await user.type(within(dialog).getByLabelText("Name"), "Historian");
  await user.selectOptions(within(dialog).getByLabelText("Role"), "operator");
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith({ organizationId: PHE, name: "Historian", role: "operator" }));
}
