import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AlarmListItem, AlarmSummaryResponse, UserRole } from "@bms/shared";

import * as alarmsApi from "../../api/alarms";
import * as maintenanceApi from "../../api/maintenance-windows";
import * as vocabApi from "../../api/vocabularies";
import { alarmItem } from "../../lib/alarm-bar.spec";
import { alarmBarFeed } from "../../lib/alarm-bar-feed";
import { EMPTY_SUMMARY, flush, installOnFakes } from "../../lib/alarm-bar-feed.spec";
import { useAlarmBarStore } from "../../stores/alarm-bar-store";
import { type AuthUser, useAuthStore } from "../../stores/auth-store";
import { AlarmBar } from "./alarm-bar";

/**
 * `F4.357` U5 (ADR 0130 decisions 1–5) — the alarm bar over a feed installed
 * on the fake ports of `alarm-bar-feed.spec.ts`. Vitest entry point:
 * `alarm-bar.test.tsx` (jsdom docblock, ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";

function signIn(role: UserRole): void {
  useAuthStore.setState({
    accessToken: "token-1",
    user: { id: "user-1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser,
  });
}

/** Shows the router's path, so a case can see that a click did not navigate. */
function PathProbe() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderBar(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AlarmBar />
        <PathProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type Answer = { list?: readonly AlarmListItem[]; summary?: AlarmSummaryResponse };

/** Signs in as `role`, installs a feed on fakes answering `answer`, renders the bar at `path`, runs `check`. */
async function withBar(
  answer: Answer,
  path: string,
  check: (fake: ReturnType<typeof installOnFakes>) => Promise<void>,
  role: UserRole = "operator",
): Promise<void> {
  signIn(role);
  // F4.359 U13: with a feed the Maintenance pill reads the windows; no request leaves the test.
  vi.spyOn(maintenanceApi, "fetchMaintenanceWindows").mockResolvedValue({ items: [] });
  const fake = installOnFakes(answer, useAuthStore);
  try {
    renderBar(path);
    await act(flush);
    await check(fake);
  } finally {
    cleanup();
    fake.uninstall();
    useAuthStore.setState({ accessToken: null, user: null });
    vi.restoreAllMocks();
  }
}

const SUMMARY: AlarmSummaryResponse = {
  total: 6,
  suppressed: 0,
  items: [
    { code: "info", label: "Info", tone: "info", rank: 10, count: 1, unacknowledged: 1 },
    { code: "warning", label: "Warning", tone: "warning", rank: 20, count: 2, unacknowledged: 2 },
    { code: "urgent", label: "Urgent", tone: "warning", rank: 25, count: 2, unacknowledged: 2 },
    { code: "critical", label: "Critical", tone: "critical", rank: 30, count: 1, unacknowledged: 1 },
  ],
};

const region = () => screen.getByRole("region", { name: "Alarms" });

/** No feed installed (every spec that renders `AppShell`): nothing renders. */
export async function rendersNothingWithoutAFeed(): Promise<void> {
  signIn("operator");
  try {
    const { container } = renderBar("/alarms");
    expect(container.querySelector('[role="region"]')).toBeNull();
  } finally {
    cleanup();
    useAuthStore.setState({ accessToken: null, user: null });
  }
}

/** Decision 5 — the page sets the scope: organization, location, or none. */
export async function readsThePagesScope(): Promise<void> {
  await withBar({}, `/control-room/org/${ORG}`, async (f) => {
    expect(f.listCalls.at(-1)).toEqual({ organizationId: ORG });
    expect(f.summaryCalls.at(-1)).toEqual({ organizationId: ORG });
  });
  await withBar({}, `/control-room/site/${SITE}/overview`, async (f) => {
    expect(f.listCalls.at(-1)).toEqual({ locationId: SITE });
  });
  await withBar({}, "/alarms", async (f) => {
    expect(f.listCalls.at(-1)).toEqual([]);
    expect(useAlarmBarStore.getState().scope).toEqual({ kind: "all" });
  });
}

/** Decision 2 — one count per summary row, rank descending, an unseeded rank in its place. */
export async function showsTheCountsByRank(): Promise<void> {
  await withBar({ summary: SUMMARY }, "/alarms", async () => {
    const counts = within(region()).getByRole("list", { name: "Active alarms by severity" });
    expect(within(counts).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Critical1 · 1 unacked",
      "Urgent2 · 2 unacked",
      "Warning2 · 2 unacked",
      "Info1 · 1 unacked",
    ]);
  });
}

/**
 * ADR 0130 Amendment 1 (owner, 2026-11-13: "Show both numbers") — each count shows the active
 * alarms and, beside them, the unacknowledged ones; acknowledging lowers only the second number.
 */
export async function showsActiveAndUnacknowledged(): Promise<void> {
  const summary: AlarmSummaryResponse = {
    total: 23,
    suppressed: 0,
    items: [
      { code: "warning", label: "Warning", tone: "warning", rank: 20, count: 3, unacknowledged: 2 },
      { code: "critical", label: "Critical", tone: "critical", rank: 30, count: 20, unacknowledged: 0 },
    ],
  };
  await withBar({ summary }, "/alarms", async () => {
    const counts = within(region()).getByRole("list", { name: "Active alarms by severity" });
    const items = within(counts).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["Critical20 · 0 unacked", "Warning3 · 2 unacked"]);
    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
      "Critical: 20 active, 0 unacknowledged",
      "Warning: 3 active, 2 unacknowledged",
    ]);
  });
}

/** Decision 2 — the newest unacknowledged alarm: message, subject, location, time; a device alarm names its RTU. */
export async function namesTheNewestUnacknowledgedAlarm(): Promise<void> {
  const comms = alarmItem({
    id: "d1",
    source: "rtu_comms",
    assetId: null,
    assetName: null,
    assetCode: null,
    siteName: null,
    assetLocationName: null,
    rtuId: "rtu-7",
    rtuCode: "RTU-07",
    message: "Communication lost",
    locationName: "Pump house",
    raisedAt: "2026-11-12T11:00:00.000Z",
  });
  await withBar({ summary: SUMMARY, list: [alarmItem({ id: "older", raisedAt: "2026-11-12T09:00:00.000Z" }), comms] }, "/alarms", async () => {
    const text = region().textContent ?? "";
    expect(text).toContain("Communication lost");
    expect(text).toContain("RTU RTU-07");
    expect(text).toContain("Pump house");
    expect(text).toContain(new Date("2026-11-12T11:00:00.000Z").toLocaleString());
  });
}

/** A zero summary says so; a stale feed says it is not updating. */
export async function saysNoAlarmsAndNotUpdating(): Promise<void> {
  await withBar({ summary: EMPTY_SUMMARY }, "/alarms", async (f) => {
    expect(within(region()).getByText("No active alarms")).toBeTruthy();
    await act(async () => {
      f.socket().disconnect();
      await flush();
    });
    expect(within(region()).getByText("Alarms not updating")).toBeTruthy();
  });
}

/** Decisions 2, 4 — All alarms opens the scoped list; a row opens the details; the page stays. */
export async function opensTheListAndTheDetails(): Promise<void> {
  const rows = [alarmItem({ id: "r1", message: "First" }), alarmItem({ id: "r2", message: "Second", severity: "info", severityRank: 10 })];
  const active = vi.spyOn(alarmsApi, "fetchActiveAlarms").mockResolvedValue({ items: rows, nextCursor: null });
  const details = vi.spyOn(alarmsApi, "fetchAlarmDetails").mockReturnValue(new Promise(() => undefined));
  vi.spyOn(vocabApi, "fetchVocabularies").mockReturnValue(new Promise(() => undefined));
  await withBar({ summary: SUMMARY }, `/control-room/org/${ORG}`, async () => {
    const user = userEvent.setup();
    await user.click(within(region()).getByRole("button", { name: "All alarms" }));
    const list = await screen.findByRole("region", { name: "All alarms — This organization" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(active).toHaveBeenCalledWith({ organizationId: ORG }, 50);
    await user.click(within(list).getByRole("button", { name: /Second/ }));
    expect(details).toHaveBeenCalledWith("r2");
    expect(screen.getByTestId("path").textContent).toBe(`/control-room/org/${ORG}`);
  });
}

/** An operator gets Acknowledge, which opens the existing dialog; a viewer does not. */
export async function offersAcknowledgeToAnOperatorOnly(): Promise<void> {
  await withBar({ summary: SUMMARY, list: [alarmItem()] }, "/alarms", async () => {
    await userEvent.setup().click(within(region()).getByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByRole("dialog", { name: "Acknowledge alarm" })).toBeTruthy();
  });
  await withBar(
    { summary: SUMMARY, list: [alarmItem()] },
    "/alarms",
    async () => {
      expect(within(region()).queryByRole("button", { name: "Acknowledge" })).toBeNull();
    },
    "viewer",
  );
}

/**
 * `F4.357` U8 (decision 11) — Mute silences the current critical alarms (pressed, "Muted"); a
 * blocked tone shows the exact "Sound blocked — click to enable", whose click unlocks and plays.
 */
export async function mutesAndOffersToEnableBlockedSound(): Promise<void> {
  await withBar({ summary: SUMMARY, list: [alarmItem({ id: "c" })] }, "/alarms", async (f) => {
    const user = userEvent.setup();
    const mute = within(region()).getByRole("button", { name: "Mute" });
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    await user.click(mute);
    const muted = within(region()).getByRole("button", { name: "Muted" });
    expect(muted.getAttribute("aria-pressed")).toBe("true");
    expect(f.tone.plays, "muted after the first tone").toBe(1);
  });
  signIn("operator");
  vi.spyOn(maintenanceApi, "fetchMaintenanceWindows").mockResolvedValue({ items: [] });
  const fake = installOnFakes({ summary: SUMMARY, list: [alarmItem({ id: "c" })] }, useAuthStore);
  fake.tone.answer = "blocked";
  try {
    renderBar("/alarms");
    await act(async () => {
      alarmBarFeed()?.refreshNow();
      await flush();
    });
    const enable = within(region()).getByRole("button", { name: "Sound blocked — click to enable" });
    await act(async () => {
      await userEvent.setup().click(enable);
      await flush();
    });
    expect(within(region()).queryByText("Sound blocked — click to enable")).toBeNull();
    expect(fake.tone.unlocks).toBe(1);
  } finally {
    cleanup();
    fake.uninstall();
    useAuthStore.setState({ accessToken: null, user: null });
  }
}
