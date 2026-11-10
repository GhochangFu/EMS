import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminRtuDto, EdgeGatewayDto } from "@bms/shared";

import * as api from "../../api/admin/edge-gateways";
import * as organizationsApi from "../../api/admin/organizations";
import * as locationsApi from "../../api/admin/locations";
import * as rtusApi from "../../api/admin/rtus";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import { EdgeGatewaysAdminPage, TOKEN_SHOWN_ONCE } from "./edge-gateways-page";

/**
 * `E7.2` (ADR 0123 decision 12, plan T6.3) — the Edge Gateways page: fails closed for a tenant
 * admin; rows come from the fixture, `unsynced` and the backlog included; a minted token shows
 * once, copies, and is gone after the dialog closes; revoke asks first; the RTU picker offers
 * only the gateway's organization. The API is spied.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const organizationAdmin = { id: "u2", email: "o@bms.local", displayName: "Org", role: "organization_admin" } as unknown as AuthUser;

const PHE = "00000000-0000-4000-8000-0000000000a1";
const ESKOM = "00000000-0000-4000-8000-0000000000a2";
const LOC = "00000000-0000-4000-8000-0000000000b1";
const RTU_PHE_1 = "00000000-0000-4000-8000-000000000c01";
const RTU_PHE_2 = "00000000-0000-4000-8000-000000000c02";
const RTU_ESKOM = "00000000-0000-4000-8000-000000000c03";
export const TOKEN = `bmsgw_${"Q".repeat(39)}wXyZ`;

const GW1: EdgeGatewayDto = {
  id: "00000000-0000-4000-8000-0000000000d1",
  organizationId: PHE,
  organizationCode: "PHE",
  organizationName: "PHE West Bengal",
  locationId: LOC,
  locationName: "Lakwa plant",
  code: "GW-LAKWA",
  name: "Lakwa box",
  status: "active",
  tokenLast4: "AbC_",
  tokenRotatedAt: "2026-11-09T10:00:00.000Z",
  lastSeenAt: "2026-11-10T08:12:00.000Z",
  reportedBacklog: 1234,
  clockState: "unsynced",
  rtuCount: 1,
  rtus: [{ id: RTU_PHE_1, code: "PHE-R1", rtuCode: "PHE-1", displayName: "RTU one" }],
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
};
const GW2: EdgeGatewayDto = {
  ...GW1,
  id: "00000000-0000-4000-8000-0000000000d2",
  code: "GW-NEW",
  name: "New box",
  tokenLast4: null,
  tokenRotatedAt: null,
  lastSeenAt: null,
  reportedBacklog: null,
  clockState: null,
  rtuCount: 0,
  rtus: [],
};
const GW_REVOKED: EdgeGatewayDto = { ...GW2, id: "00000000-0000-4000-8000-0000000000d3", code: "GW-OLD", status: "revoked" };

function rtu(id: string, code: string, organizationCode: string): AdminRtuDto {
  return {
    id,
    locationId: LOC,
    locationName: "Lakwa plant",
    organizationCode,
    code,
    displayName: `${code} display`,
    sourceType: "mqtt",
    domain: null,
    externalRtuId: null,
    rtuCode: code,
    mqttTopic: null,
    releasedMqttTopic: null,
    expectedIntervalSeconds: null,
    stationCode: null,
    stationName: null,
    ingestEnabled: true,
    organizationIngestEnabled: true,
    active: true,
    meta: null,
    createdAt: "2026-11-09T00:00:00.000Z",
    tls: true,
    payloadFormat: null,
  };
}

function renderPage(as: AuthUser): QueryClient {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(api, "fetchEdgeGateways").mockResolvedValue([GW1, GW2, GW_REVOKED]);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [
      { id: PHE, code: "PHE", name: "PHE West Bengal" },
      { id: ESKOM, code: "ESKOM", name: "Eskom" },
    ],
  } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [{ id: LOC, name: "Lakwa plant", organizationId: PHE }] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({
    items: [rtu(RTU_PHE_1, "PHE-1", "PHE"), rtu(RTU_PHE_2, "PHE-2", "PHE"), rtu(RTU_ESKOM, "ESKOM-9", "ESKOM")],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/edge-gateways"]}>
        <EdgeGatewaysAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

async function rowOf(code: string): Promise<HTMLElement> {
  const row = (await screen.findByText(code)).closest("tr");
  if (!row) throw new Error(`no row for ${code}`);
  return row;
}

/** E1 — a tenant admin sees the status line, and no gateway read runs. */
export async function aTenantAdminSeesTheStatusLine(): Promise<void> {
  renderPage(organizationAdmin);
  expect(await screen.findByRole("status")).toHaveTextContent("Edge gateways are managed by a global administrator.");
  expect(api.fetchEdgeGateways).not.toHaveBeenCalled();
}

/** E2 — the rows: organization, location, status, last seen, backlog, a marked `unsynced` clock, the token's last four, the RTU count. */
export async function theRowsComeFromTheList(): Promise<void> {
  renderPage(admin);
  const row = await rowOf("GW-LAKWA");
  for (const text of ["Lakwa box", "PHE", "Lakwa plant", "Active", "2026-11-10 08:12 UTC", "1234", "Token ends in …AbC_, rotated 2026-11-09", "1"]) {
    expect(within(row).getByText(text)).toBeInTheDocument();
  }
  // `unsynced` is marked with a pill, not plain text.
  expect(within(row).getByText("Unsynced").className).toMatch(/warning/);
  const fresh = await rowOf("GW-NEW");
  expect(within(fresh).getByText("No token")).toBeInTheDocument();
  expect(within(fresh).getByText("Never")).toBeInTheDocument();
  expect(within(fresh).getByRole("button", { name: "Mint token for GW-NEW" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Rotate token for GW-LAKWA" })).toBeInTheDocument();
  // A revoked gateway offers no token, RTU or revoke control.
  const revoked = await rowOf("GW-OLD");
  expect(within(revoked).getByText("Revoked")).toBeInTheDocument();
  expect(within(revoked).queryByRole("button", { name: /token|RTUs|Revoke/ })).toBeNull();
}

/** E3 — the token shows once, copies, and is gone after the dialog closes; reopening offers a new mint, not the old token. */
export async function theTokenShowsOnce(): Promise<void> {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const mint = vi.spyOn(api, "mintEdgeGatewayToken").mockResolvedValue({ gateway: { ...GW1, tokenLast4: "wXyZ" }, token: TOKEN });
  const client = renderPage(admin);
  await user.click(within(await rowOf("GW-LAKWA")).getByRole("button", { name: "Rotate token for GW-LAKWA" }));
  const dialog = await screen.findByRole("dialog", { name: "Rotate token" });
  expect(within(dialog).getByText(/the current token stops working/i)).toBeInTheDocument();
  expect(mint).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Rotate token" }));
  expect(await within(dialog).findByDisplayValue(TOKEN)).toBeInTheDocument();
  expect(within(dialog).getByText(TOKEN_SHOWN_ONCE)).toBeInTheDocument();
  expect(mint).toHaveBeenCalledWith(GW1.id);
  await user.click(within(dialog).getByRole("button", { name: "Copy token" }));
  expect(writeText).toHaveBeenCalledWith(TOKEN);
  expect(await within(dialog).findByText("Copied.")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.body.innerHTML).not.toContain(TOKEN);
  // Nothing the client keeps holds it: not a query, not a finished mutation.
  expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(TOKEN);
  expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state.data ?? null))).not.toContain(TOKEN);

  await user.click(within(await rowOf("GW-LAKWA")).getByRole("button", { name: "Rotate token for GW-LAKWA" }));
  const again = await screen.findByRole("dialog", { name: "Rotate token" });
  expect(within(again).queryByDisplayValue(TOKEN)).toBeNull();
  expect(document.body.innerHTML).not.toContain(TOKEN);
}

/** E4 — revoke asks first, says it is final, and only then calls the route. */
export async function revokeAsksFirst(): Promise<void> {
  const user = userEvent.setup();
  const revoke = vi.spyOn(api, "revokeEdgeGateway").mockResolvedValue({ ...GW1, status: "revoked", rtus: [], rtuCount: 0 });
  renderPage(admin);
  await user.click(within(await rowOf("GW-LAKWA")).getByRole("button", { name: "Revoke GW-LAKWA" }));
  const dialog = await screen.findByRole("dialog", { name: "Revoke edge gateway" });
  expect(within(dialog).getByText(/revoke is final/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/1 RTU/)).toBeInTheDocument();
  expect(revoke).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Revoke gateway" }));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith(GW1.id));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

/** E5 — the RTU picker offers only the gateway's organization, preselects its RTUs, and saves the set. */
export async function thePickerIsTheOrganizations(): Promise<void> {
  const user = userEvent.setup();
  const put = vi.spyOn(api, "putEdgeGatewayRtus").mockResolvedValue({ ...GW1, rtuCount: 2 });
  renderPage(admin);
  await user.click(within(await rowOf("GW-LAKWA")).getByRole("button", { name: "RTUs of GW-LAKWA" }));
  const dialog = await screen.findByRole("dialog", { name: "Assign RTUs" });
  const one = await within(dialog).findByRole("checkbox", { name: /PHE-1/ });
  expect(one).toBeChecked();
  const two = within(dialog).getByRole("checkbox", { name: /PHE-2/ });
  expect(two).not.toBeChecked();
  expect(within(dialog).queryByText(/ESKOM-9/)).toBeNull();
  expect(within(dialog).getAllByRole("checkbox")).toHaveLength(2);
  await user.click(two);
  await user.click(within(dialog).getByRole("button", { name: "Save RTUs" }));
  await waitFor(() => expect(put).toHaveBeenCalledWith(GW1.id, [RTU_PHE_1, RTU_PHE_2]));
}

/** E6 — create sends the organization, the optional location, the code and the name. */
export async function createSendsTheBody(): Promise<void> {
  const user = userEvent.setup();
  const create = vi.spyOn(api, "createEdgeGateway").mockResolvedValue(GW2);
  renderPage(admin);
  await rowOf("GW-LAKWA");
  await user.click(screen.getByRole("button", { name: "New gateway" }));
  const dialog = await screen.findByRole("dialog", { name: "New edge gateway" });
  await user.selectOptions(await within(dialog).findByLabelText("Organization"), PHE);
  await user.selectOptions(await within(dialog).findByLabelText("Location"), LOC);
  await user.type(within(dialog).getByLabelText("Code"), "GW-NEW");
  await user.type(within(dialog).getByLabelText("Name"), "New box");
  await user.click(within(dialog).getByRole("button", { name: "Create gateway" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({ organizationId: PHE, locationId: LOC, code: "GW-NEW", name: "New box" }),
  );
}

/** E7 — rename sends the new name; a refusal renders as a sentence, not a JSON envelope. */
export async function renameSendsTheName(): Promise<void> {
  const user = userEvent.setup();
  const update = vi.spyOn(api, "updateEdgeGateway").mockRejectedValueOnce(new Error('{"statusCode":409,"message":"Nope"}'));
  renderPage(admin);
  await user.click(within(await rowOf("GW-LAKWA")).getByRole("button", { name: "Rename GW-LAKWA" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename edge gateway" });
  const name = within(dialog).getByLabelText("Name");
  await user.clear(name);
  await user.type(name, "Lakwa box 2");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(GW1.id, { name: "Lakwa box 2", locationId: LOC }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Nope");
  expect(within(dialog).getByRole("alert").textContent).not.toContain("statusCode");
}
