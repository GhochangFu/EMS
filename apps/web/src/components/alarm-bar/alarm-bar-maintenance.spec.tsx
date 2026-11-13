import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AlarmListItem, AlarmSummaryResponse, UserRole } from "@bms/shared";
import type { MaintenanceWindowItem } from "@bms/shared/contracts";

import * as alarmsApi from "../../api/alarms";
import * as maintenanceApi from "../../api/maintenance-windows";
import { alarmItem } from "../../lib/alarm-bar.spec";
import { EMPTY_SUMMARY, flush, installOnFakes } from "../../lib/alarm-bar-feed.spec";
import { type AuthUser, useAuthStore } from "../../stores/auth-store";
import { AlarmBar } from "./alarm-bar";

/**
 * `F4.359` U13 (ADR 0131 decisions 6, 15, 19; plan D17, Q4) — the bar's "Maintenance N" pill, its
 * panel, and the "All alarms" panel without suppressed rows, over a feed installed on the fake ports
 * of `alarm-bar-feed.spec.ts`. Vitest entry point: `alarm-bar-maintenance.test.tsx` (jsdom).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ENDS_AT = "2026-11-13T18:00:00.000Z";

function maintenanceWindow(over: Partial<MaintenanceWindowItem> = {}): MaintenanceWindowItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId: ORG,
    reason: "Chiller overhaul",
    startsAt: "2026-11-13T08:00:00.000Z",
    endsAt: ENDS_AT,
    endedAt: null,
    state: "active",
    createdByName: "Admin",
    endedByName: null,
    workOrder: null,
    maintenanceSchedule: null,
    targets: [
      { kind: "asset", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Chiller 1" },
      { kind: "location", id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Plant room" },
    ],
    assetIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ...over,
  };
}

const summaryWith = (suppressed: number): AlarmSummaryResponse => ({ ...EMPTY_SUMMARY, suppressed });

function signIn(role: UserRole): void {
  useAuthStore.setState({
    accessToken: "token-1",
    user: { id: "user-1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser,
  });
}

function renderBar(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AlarmBar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type Answer = { list?: readonly AlarmListItem[]; summary?: AlarmSummaryResponse };

/** Answers the windows read with `windows`, installs a feed answering `answer`, renders the bar at `path`. */
async function withBar(
  windows: readonly MaintenanceWindowItem[],
  answer: Answer,
  check: (ctx: { read: ReturnType<typeof vi.spyOn>; fake: ReturnType<typeof installOnFakes> }) => Promise<void>,
  { role = "operator", path = "/alarms" }: { role?: UserRole; path?: string } = {},
): Promise<void> {
  const read = vi.spyOn(maintenanceApi, "fetchMaintenanceWindows").mockResolvedValue({ items: [...windows] });
  signIn(role);
  const fake = installOnFakes(answer, useAuthStore);
  try {
    renderBar(path);
    await act(flush);
    await waitFor(() => expect(read).toHaveBeenCalled());
    await act(flush);
    await check({ read, fake });
  } finally {
    cleanup();
    fake.uninstall();
    useAuthStore.setState({ accessToken: null, user: null });
    vi.restoreAllMocks();
  }
}

const region = () => screen.getByRole("region", { name: "Alarms" });
const pill = () => within(region()).queryByRole("button", { name: /^Maintenance/ });

/** Decision 15, D17 — one active window: the pill reads the summary's suppressed count; the read is the page scope's active windows. */
export async function thePillShowsTheSuppressedCount(): Promise<void> {
  await withBar([maintenanceWindow()], { summary: summaryWith(3) }, async ({ read }) => {
    expect(pill()?.textContent).toBe("Maintenance 3");
    expect(pill()?.getAttribute("aria-label")).toBe("Maintenance: 3 suppressed alarms");
    expect(read).toHaveBeenCalledWith({ state: "active" });
  });
  await withBar(
    [maintenanceWindow()],
    { summary: summaryWith(3) },
    async ({ read }) => {
      expect(read).toHaveBeenCalledWith({ state: "active", organizationId: ORG });
    },
    { path: `/control-room/org/${ORG}` },
  );
  await withBar(
    [maintenanceWindow()],
    { summary: summaryWith(3) },
    async ({ read }) => {
      expect(read).toHaveBeenCalledWith({ state: "active", locationId: SITE });
    },
    { path: `/control-room/site/${SITE}` },
  );
}

/** Decision 15 — no active window in the scope: no pill, even with suppressed alarms counted. */
export async function noWindowNoPill(): Promise<void> {
  await withBar([], { summary: summaryWith(3) }, async () => {
    expect(pill()).toBeNull();
  });
}

/** Decision 15 — a window that suppresses nothing (yet) still shows: "Maintenance 0". */
export async function aWindowWithNothingSuppressedShowsZero(): Promise<void> {
  await withBar([maintenanceWindow()], { summary: summaryWith(0) }, async () => {
    expect(pill()?.textContent).toBe("Maintenance 0");
  });
}

/** Decisions 6, 15 — the pill never blinks (a critical count beside it does) and suppressed alarms sound nothing. */
export async function thePillNeverBlinksOrSounds(): Promise<void> {
  await withBar([maintenanceWindow()], { summary: summaryWith(2) }, async ({ fake }) => {
    const button = pill();
    expect(button).not.toBeNull();
    expect(button?.hasAttribute("data-blink")).toBe(false);
    expect(region().querySelector('[data-blink="true"]')).toBeNull();
    expect(fake.tone.plays, "suppressed alarms play no tone").toBe(0);
  });
  // One unseen critical alarm beside the pill: its count blinks and the tone plays; the pill still does neither.
  const critical = alarmItem({ id: "c1", message: "Breaker trip" });
  const summary: AlarmSummaryResponse = {
    total: 1,
    suppressed: 2,
    items: EMPTY_SUMMARY.items.map((row) => (row.code === "critical" ? { ...row, count: 1, unacknowledged: 1 } : row)),
  };
  await withBar([maintenanceWindow()], { list: [critical], summary }, async ({ fake }) => {
    const criticalCount = within(region()).getByRole("listitem", { name: /^Critical:/ });
    expect(criticalCount.getAttribute("data-blink")).toBe("true");
    expect(fake.tone.plays, "the critical alarm sounds").toBeGreaterThan(0);
    const button = pill();
    expect(button?.textContent).toBe("Maintenance 2");
    expect(button?.hasAttribute("data-blink")).toBe(false);
    expect(button?.className).not.toContain("alarm-bar-blink");
  });
}

/** Decision 15 — a click opens the windows upward: reason, end time, targets; an admin also gets the admin page. */
export async function aClickOpensTheWindows(): Promise<void> {
  for (const [role, link] of [
    ["organization_admin", true],
    ["operator", false],
    // AdminRoute admits only isMasterDataAdmin: an asset-group admin manages windows but would bounce off the page.
    ["asset_group_admin", false],
  ] as const) {
    await withBar(
      [maintenanceWindow(), maintenanceWindow({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", reason: "UPS battery swap", targets: [] })],
      { summary: summaryWith(1) },
      async () => {
        const user = userEvent.setup();
        expect(screen.queryByRole("region", { name: "Active maintenance windows" })).toBeNull();
        await user.click(pill()!);
        expect(pill()?.getAttribute("aria-expanded")).toBe("true");
        const panel = screen.getByRole("region", { name: "Active maintenance windows" });
        expect(panel.hasAttribute("data-wall-bar")).toBe(true);
        const items = within(panel).getAllByRole("listitem");
        expect(items).toHaveLength(2);
        expect(items[0]!.textContent).toContain("Chiller overhaul");
        expect(items[0]!.textContent).toContain(`Ends ${new Date(ENDS_AT).toLocaleString()}`);
        expect(items[0]!.textContent).toContain("Chiller 1, Plant room");
        expect(items[1]!.textContent).toContain("UPS battery swap");
        const admin = within(panel).queryByRole("link", { name: "Manage maintenance windows" });
        expect(admin !== null, role).toBe(link);
        if (admin !== null) expect(admin.getAttribute("href")).toBe("/admin/maintenance-windows");
        await user.click(within(panel).getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("region", { name: "Active maintenance windows" })).toBeNull();
      },
      { role },
    );
  }
}

/** Plan Q4 — "All alarms" drops a suppressed row and says how many it dropped, linking to the Alarm Centre. */
export async function allAlarmsDropsSuppressedRows(): Promise<void> {
  const rows = [
    alarmItem({ id: "s1", message: "Suppressed trip", suppressed: true, maintenanceWindowId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    alarmItem({ id: "r1", message: "Live trip", severity: "warning", severityRank: 20 }),
  ];
  vi.spyOn(alarmsApi, "fetchActiveAlarms").mockResolvedValue({ items: rows, nextCursor: null });
  // N is the scope's summary count (the pill's), not the rows the panel's 50-row read happened to drop.
  await withBar([maintenanceWindow()], { summary: summaryWith(7) }, async () => {
    const user = userEvent.setup();
    await user.click(within(region()).getByRole("button", { name: "All alarms" }));
    const list = await screen.findByRole("region", { name: "All alarms — All alarms you can read" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(list.textContent).toContain("Live trip");
    expect(list.textContent).not.toContain("Suppressed trip");
    const line = within(list).getByRole("link", { name: "7 suppressed by maintenance" });
    expect(line.getAttribute("href")).toBe("/alarms");
  });
  vi.spyOn(alarmsApi, "fetchActiveAlarms").mockResolvedValue({ items: [rows[1]!], nextCursor: null });
  await withBar([], { summary: summaryWith(0) }, async () => {
    const user = userEvent.setup();
    await user.click(within(region()).getByRole("button", { name: "All alarms" }));
    const list = await screen.findByRole("region", { name: "All alarms — All alarms you can read" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(within(list).queryByRole("link", { name: /suppressed by maintenance/ }), "none dropped: no line").toBeNull();
  });
}

const ALL_SUPPRESSED_LINE = "The newest active alarms are all suppressed by maintenance — open the Alarm Centre";

/** Plan Q4 — a read whose rows are all suppressed is not "No active alarms"; an empty read still is. */
export async function anAllSuppressedReadIsNotNoActiveAlarms(): Promise<void> {
  const suppressed = alarmItem({ id: "s1", message: "Suppressed trip", suppressed: true, maintenanceWindowId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  vi.spyOn(alarmsApi, "fetchActiveAlarms").mockResolvedValue({ items: [suppressed], nextCursor: null });
  await withBar([maintenanceWindow()], { summary: summaryWith(1) }, async () => {
    const user = userEvent.setup();
    await user.click(within(region()).getByRole("button", { name: "All alarms" }));
    const list = await screen.findByRole("region", { name: "All alarms — All alarms you can read" });
    await within(list).findByText(ALL_SUPPRESSED_LINE);
    expect(list.textContent).not.toContain("No active alarms");
    expect(within(list).queryAllByRole("listitem")).toHaveLength(0);
  });
  vi.spyOn(alarmsApi, "fetchActiveAlarms").mockResolvedValue({ items: [], nextCursor: null });
  await withBar([], { summary: summaryWith(0) }, async () => {
    const user = userEvent.setup();
    await user.click(within(region()).getByRole("button", { name: "All alarms" }));
    const list = await screen.findByRole("region", { name: "All alarms — All alarms you can read" });
    await within(list).findByText("No active alarms");
    expect(within(list).queryByText(ALL_SUPPRESSED_LINE)).toBeNull();
  });
}

/** D17 — no feed installed (every spec that renders `AppShell`): the windows read is never issued. */
export async function noFeedNoWindowsRead(): Promise<void> {
  const read = vi.spyOn(maintenanceApi, "fetchMaintenanceWindows").mockResolvedValue({ items: [maintenanceWindow()] });
  signIn("operator");
  try {
    const { container } = renderBar("/alarms");
    await act(flush);
    expect(read).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Maintenance");
  } finally {
    cleanup();
    useAuthStore.setState({ accessToken: null, user: null });
    vi.restoreAllMocks();
  }
}
