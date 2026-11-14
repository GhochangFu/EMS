import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope, UserRole } from "@bms/shared";
import type { MaintenanceWindowItem } from "@bms/shared/contracts";

import * as copilotApi from "../../api/copilot";
import * as windowsApi from "../../api/maintenance-windows";
import * as systemStatusApi from "../../api/system-status";
import { spyReads, windowItem } from "../../components/maintenance/maintenance-window-wizards.spec";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { visibleMasterDataTabs } from "../../lib/admin-access";
import { localMinuteOf, localZoneLabel } from "../../lib/maintenance-window-time";
import { type AuthUser, useAuthStore } from "../../stores/auth-store";
import { MaintenanceWindowsRoute } from "./maintenance-windows-page";

/**
 * `F4.359` U15 (ADR 0131 decision 16; plan ruling Q6) — the Maintenance windows page: three
 * sections, the row actions each state allows, a 409 that refetches, and the route's guard.
 * `maintenance-windows-page.test.tsx` is the Vitest entry point and pins `TZ=Asia/Kolkata`.
 */

const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };
const DAY = 24 * 60 * 60 * 1000;

const ACTIVE = windowItem({ id: "00000000-0000-4000-8000-0000000000f1", reason: "Pump overhaul" });
const FUTURE = windowItem({
  id: "00000000-0000-4000-8000-0000000000f2",
  reason: "Valve swap",
  state: "future",
  startsAt: new Date(Date.now() + DAY).toISOString(),
  endsAt: new Date(Date.now() + 2 * DAY).toISOString(),
});
const PAST = windowItem({
  id: "00000000-0000-4000-8000-0000000000f3",
  reason: "Panel rewiring",
  state: "past",
  startsAt: new Date(Date.now() - 3 * DAY).toISOString(),
  endsAt: new Date(Date.now() - 2 * DAY).toISOString(),
});

function asUser(role: UserRole): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

function renderRoute(
  role: UserRole,
  lists: Partial<Record<"active" | "future" | "past", MaintenanceWindowItem[]>> = {},
): ReturnType<typeof vi.spyOn> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  spyReads();
  const byState: Record<string, MaintenanceWindowItem[]> = { active: [ACTIVE], future: [FUTURE], past: [PAST], ...lists };
  const list = vi
    .spyOn(windowsApi, "fetchMaintenanceWindows")
    .mockImplementation(async (query = {}) => ({ items: byState[query.state ?? ""] ?? [] }));
  useAuthStore.setState({ accessToken: "token", user: asUser(role), scope: GLOBAL });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/maintenance-windows"]}>
        <Routes>
          <Route path="/" element={<p>HOME</p>} />
          <Route path="/admin/maintenance-windows" element={<MaintenanceWindowsRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return list;
}

const table = (name: string): HTMLElement => screen.getByRole("table", { name });
const rowOf = async (tableName: string, reason: string): Promise<HTMLElement> =>
  within(table(tableName)).findByRole("row", { name: new RegExp(reason) });

/** P1 — each section holds its own state's rows; past asks for the newest 100. */
export async function theThreeSectionsHoldTheRightRows(): Promise<void> {
  const list = renderRoute("organization_admin");
  expect(await rowOf("Active maintenance windows", "Pump overhaul")).toBeInTheDocument();
  expect(await rowOf("Future maintenance windows", "Valve swap")).toBeInTheDocument();
  expect(await rowOf("Past maintenance windows", "Panel rewiring")).toBeInTheDocument();
  expect(within(table("Active maintenance windows")).queryByText("Valve swap")).toBeNull();
  expect(within(table("Future maintenance windows")).queryByText("Pump overhaul")).toBeNull();
  expect(within(table("Past maintenance windows")).queryByText("Pump overhaul")).toBeNull();
  expect(list).toHaveBeenCalledWith({ state: "past", limit: 100 });
}

/** P2 — Extend and End only on an active row; Cancel only on a future one; a past row has none. */
export async function eachRowOffersOnlyItsStatesActions(): Promise<void> {
  renderRoute("organization_admin");
  const buttons = (row: HTMLElement) => within(row).queryAllByRole("button").map((button) => button.textContent);
  expect(buttons(await rowOf("Active maintenance windows", "Pump overhaul"))).toEqual(["Extend", "End"]);
  expect(buttons(await rowOf("Future maintenance windows", "Valve swap"))).toEqual(["Cancel"]);
  expect(buttons(await rowOf("Past maintenance windows", "Panel rewiring"))).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Create window" }));
  expect(screen.getByRole("dialog", { name: "Create maintenance window" })).toBeInTheDocument();
}

/** P3 — a 409 shows the route's message in the wizard and refetches the list. */
export async function aConflictShowsItsMessageAndRefetches(): Promise<void> {
  const list = renderRoute("organization_admin");
  vi.spyOn(windowsApi, "endMaintenanceWindow").mockRejectedValue(
    new Error(JSON.stringify({ message: "Only an active maintenance window can be ended", error: "Conflict", statusCode: 409 })),
  );
  await userEvent.click(within(await rowOf("Active maintenance windows", "Pump overhaul")).getByRole("button", { name: 'End window "Pump overhaul"' }));
  const dialog = screen.getByRole("dialog", { name: "End maintenance window" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  const before = list.mock.calls.length;
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Only an active maintenance window can be ended")).toBeInTheDocument();
  await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  expect(screen.getByRole("dialog", { name: "End maintenance window" })).toBeInTheDocument();
}

/** P4 — a `location_admin` (a site admin, ADR 0131 decision 13) sees the page and its tab. */
export async function aLocationAdminSeesThePageAndItsTab(): Promise<void> {
  renderRoute("location_admin");
  expect(await screen.findByRole("heading", { level: 1, name: "Maintenance Windows" })).toBeInTheDocument();
  expect(visibleMasterDataTabs("location_admin").map((tab) => tab.path)).toContain("/admin/maintenance-windows");
}

/** P5 — an `operator` is not a master-data role: `AdminRoute` sends it home. */
export async function anOperatorIsRedirected(): Promise<void> {
  renderRoute("operator");
  expect(await screen.findByText("HOME")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Maintenance Windows" })).toBeNull();
}

/** P6 — every time is in the browser's zone, and the Start and End columns name it. */
export async function theTimesAreInTheBrowsersZone(): Promise<void> {
  expect(localZoneLabel()).toBe("UTC+05:30");
  const at = windowItem({ id: "00000000-0000-4000-8000-0000000000f4", reason: "Meter swap", startsAt: "2026-11-13T08:00:00.000Z", endsAt: "2026-11-13T10:15:00.000Z" });
  renderRoute("organization_admin", { active: [at] });
  const row = await rowOf("Active maintenance windows", "Meter swap");
  const headers = within(table("Active maintenance windows")).getAllByRole("columnheader").map((cell) => cell.textContent);
  expect(headers.slice(1, 3)).toEqual(["Start (UTC+05:30)", "End (UTC+05:30)"]);
  const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
  expect(cells.slice(1, 3)).toEqual(["2026-11-13 13:30", "2026-11-13 15:45"]);
  expect(localMinuteOf(at.startsAt)).toBe("2026-11-13 13:30");
}

/** P7 — Future lists the soonest start first, whatever order the API answers in. */
export async function futureListsTheSoonestFirst(): Promise<void> {
  const later = windowItem({ ...FUTURE, id: "00000000-0000-4000-8000-0000000000f5", reason: "Later swap", startsAt: new Date(Date.now() + 3 * DAY).toISOString(), endsAt: new Date(Date.now() + 4 * DAY).toISOString() });
  // The API orders by start, newest first.
  renderRoute("organization_admin", { future: [later, FUTURE] });
  await rowOf("Future maintenance windows", "Later swap");
  const reasons = within(table("Future maintenance windows"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent);
  expect(reasons).toEqual(["Valve swap", "Later swap"]);
}

/** P8 — the sections re-read every minute, so a window that starts or ends by the clock moves section. */
export async function theSectionsRereadEveryMinute(): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const list = renderRoute("organization_admin");
    await rowOf("Future maintenance windows", "Valve swap");
    const reads = (state: string): number => list.mock.calls.filter((call: unknown[]) => (call[0] as { state?: string } | undefined)?.state === state).length;
    const before = { active: reads("active"), future: reads("future"), past: reads("past") };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(reads("active")).toBeGreaterThan(before.active);
    expect(reads("future")).toBeGreaterThan(before.future);
    expect(reads("past")).toBeGreaterThan(before.past);
  } finally {
    vi.useRealTimers();
  }
}

/**
 * P9 — `F4.360` defect 3: a future window cancelled before its start is "Cancelled by …" in Past, with no end
 * time (its `endedAt` is before its start); a window ended early keeps its end and "Ended by". Mutation: show
 * `endedAt` for every ended window → red.
 */
export async function aCancelledWindowSaysCancelled(): Promise<void> {
  const cancelled = windowItem({
    id: "00000000-0000-4000-8000-0000000000f6",
    reason: "Valve swap cancelled",
    state: "past",
    startsAt: "2026-11-14T03:45:00.000Z",
    endsAt: "2026-11-14T05:00:00.000Z",
    endedAt: "2026-11-14T02:49:00.000Z",
    endedByName: "Ops Lead",
  });
  const endedEarly = windowItem({
    id: "00000000-0000-4000-8000-0000000000f7",
    reason: "Pump ended early",
    state: "past",
    startsAt: "2026-11-14T02:35:00.000Z",
    endsAt: "2026-11-14T03:35:00.000Z",
    endedAt: "2026-11-14T02:46:00.000Z",
    endedByName: "Ops Lead",
  });
  renderRoute("organization_admin", { past: [cancelled, endedEarly] });
  const endCell = async (reason: string): Promise<string> =>
    within(await rowOf("Past maintenance windows", reason)).getAllByRole("cell")[2]?.textContent ?? "";
  expect(await endCell("Valve swap cancelled")).toBe("CancelledCancelled by Ops Lead");
  expect(await endCell("Pump ended early")).toBe(`${localMinuteOf(endedEarly.endedAt as string)}Ended by Ops Lead`);
}

/** P10 — `F4.360` defect 5: each row action names its window. Mutation: drop the `aria-label` → red. */
export async function theRowActionsNameTheirWindow(): Promise<void> {
  renderRoute("organization_admin");
  const active = await rowOf("Active maintenance windows", "Pump overhaul");
  expect(within(active).getByRole("button", { name: 'Extend window "Pump overhaul"' })).toBeInTheDocument();
  expect(within(active).getByRole("button", { name: 'End window "Pump overhaul"' })).toBeInTheDocument();
  const future = await rowOf("Future maintenance windows", "Valve swap");
  expect(within(future).getByRole("button", { name: 'Cancel window "Valve swap"' })).toBeInTheDocument();
}
