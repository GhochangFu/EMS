import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { WorkOrderSlaPoliciesResponse } from "@bms/shared";

import * as organizationsApi from "../../api/admin/organizations";
import * as api from "../../api/admin/work-order-sla-policies";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { WorkOrderSlaPoliciesAdminPage } from "./work-order-sla-policies-page";

/**
 * `E3.1` (ADR 0122 decision 3, plan D8) — the Work Order SLA admin screen, rendered
 * (ADR 0042). Assertions live here; `work-order-sla-policies-page.test.tsx` is the
 * Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 */

const asUser = (role: string): AuthUser =>
  ({ id: "u1", email: `${role}@bms.local`, displayName: role, role }) as unknown as AuthUser;

const ORG_ID = "11111111-1111-4111-8111-111111111111";

/** Low is the organization's own row (7 minutes); the other three are the platform default. */
const POLICIES: WorkOrderSlaPoliciesResponse = {
  organizationId: ORG_ID,
  items: [
    { priority: "low", resolutionMinutes: 7, source: "organization" },
    { priority: "medium", resolutionMinutes: 240, source: "default" },
    { priority: "high", resolutionMinutes: 60, source: "default" },
    { priority: "critical", resolutionMinutes: 30, source: "default" },
  ],
};

function stubAll(): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: ORG_ID, code: "E31ORG", name: "Spec organization" }],
  } as never);
  vi.spyOn(api, "fetchWorkOrderSlaPolicies").mockResolvedValue(POLICIES);
  vi.spyOn(api, "putWorkOrderSlaPolicies").mockResolvedValue(POLICIES);
}

function renderPage(as: AuthUser): void {
  stubAll();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/work-order-sla"]}>
        <WorkOrderSlaPoliciesAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rowOf(label: string): Promise<HTMLElement> {
  const input = await screen.findByLabelText(`Minutes for ${label}`);
  const row = input.closest("tr");
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

/** S1 — a location admin and an operator see the status sentence and nothing is fetched. */
export async function failsClosedForOtherRoles(): Promise<void> {
  for (const role of ["location_admin", "operator"]) {
    vi.restoreAllMocks();
    renderPage(asUser(role));
    expect(
      screen.getByText("Work-order SLA policies are set by an organization administrator or a global administrator."),
    ).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("table")).toBeNull();
    expect(organizationsApi.fetchAdminOrganizations).toHaveBeenCalledTimes(0);
    expect(api.fetchWorkOrderSlaPolicies).toHaveBeenCalledTimes(0);
    document.body.innerHTML = "";
  }
}

/** S2 — four rows in the order critical, high, medium, low; defaults marked, the own row marked. */
export async function showsFourRowsInOrderWithMarkers(): Promise<void> {
  renderPage(asUser("organization_admin"));
  await screen.findByLabelText("Minutes for Critical");
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows.map((row) => within(row).getByRole("spinbutton").getAttribute("aria-label"))).toEqual([
    "Minutes for Critical",
    "Minutes for High",
    "Minutes for Medium",
    "Minutes for Low",
  ]);
  expect(api.fetchWorkOrderSlaPolicies).toHaveBeenCalledWith(ORG_ID);
  expect(within(await rowOf("Critical")).getByText("Platform default")).toBeInTheDocument();
  expect(within(await rowOf("High")).getByText("1h")).toBeInTheDocument();
  const low = await rowOf("Low");
  expect(within(low).getByText("Set for this organization")).toBeInTheDocument();
  expect(within(low).getByText("7 mins")).toBeInTheDocument();
  expect(screen.getByText(/A change here applies to work orders created from now on/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
}

/** S3 — typing 45 on High reads `45 mins`; Save sends it plus the already-own Low row. */
export async function savingSendsOnlyTheOrganizationsRows(): Promise<void> {
  const user = userEvent.setup();
  renderPage(asUser("admin"));
  const high = await rowOf("High");
  const input = within(high).getByLabelText("Minutes for High");
  await user.clear(input);
  await user.type(input, "45");
  expect(within(high).getByText("45 mins")).toBeInTheDocument();
  expect(within(high).getByText("Set for this organization")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.putWorkOrderSlaPolicies).toHaveBeenCalledTimes(1));
  expect(api.putWorkOrderSlaPolicies).toHaveBeenCalledWith(ORG_ID, [
    { priority: "high", resolutionMinutes: 45 },
    { priority: "low", resolutionMinutes: 7 },
  ]);
}

/** S4 — Use default leaves the row out of the write. */
export async function useDefaultLeavesTheRowOut(): Promise<void> {
  const user = userEvent.setup();
  renderPage(asUser("admin"));
  const low = await rowOf("Low");
  await user.click(within(low).getByRole("button", { name: "Use default" }));
  expect(within(low).getByText("Platform default")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.putWorkOrderSlaPolicies).toHaveBeenCalledTimes(1));
  expect(api.putWorkOrderSlaPolicies).toHaveBeenCalledWith(ORG_ID, []);
}

/** S5 — an out-of-range value disables Save and shows the range sentence. */
export async function anOutOfRangeValueDisablesSave(): Promise<void> {
  const user = userEvent.setup();
  renderPage(asUser("admin"));
  const high = await rowOf("High");
  const input = within(high).getByLabelText("Minutes for High");
  await user.clear(input);
  await user.type(input, "525601");
  expect(screen.getByText("Enter whole minutes from 1 to 525600.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.clear(input);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
}

/** S6 — a refusal shows the server's sentence, not the envelope. */
export async function aRefusalShowsTheSentence(): Promise<void> {
  const user = userEvent.setup();
  renderPage(asUser("admin"));
  vi.mocked(api.putWorkOrderSlaPolicies).mockImplementation(() =>
    Promise.reject(new ApiError('{"statusCode":403,"message":"Not allowed for this organization","error":"Forbidden"}', 403)),
  );
  const high = await rowOf("High");
  const input = within(high).getByLabelText("Minutes for High");
  await user.clear(input);
  await user.type(input, "45");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const banner = await screen.findByRole("alert");
  expect(banner.textContent).toBe("Not allowed for this organization");
}
