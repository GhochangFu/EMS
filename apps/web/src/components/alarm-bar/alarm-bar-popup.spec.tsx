import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AlarmListItem, AlarmSummaryResponse, UserRole } from "@bms/shared";

import * as alarmsApi from "../../api/alarms";
import { alarmItem } from "../../lib/alarm-bar.spec";
import { EMPTY_SUMMARY, flush, installOnFakes } from "../../lib/alarm-bar-feed.spec";
import { alarmBarFeed } from "../../lib/alarm-bar-feed";
import { type AuthUser, useAuthStore } from "../../stores/auth-store";
import { AlarmBar } from "./alarm-bar";

/**
 * `F4.357` U6 (ADR 0130 decisions 6–8, 18, 21) — the one popup for new alarms, rendered by the bar
 * over a feed on the fake ports of `alarm-bar-feed.spec.ts`. Vitest entry point:
 * `alarm-bar-popup.test.tsx` (jsdom docblock, ADR 0014).
 */

function signIn(role: UserRole): void {
  useAuthStore.setState({
    accessToken: "token-1",
    user: { id: "user-1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser,
  });
}

function mount(path = "/alarms") {
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
type Fake = ReturnType<typeof installOnFakes>;

async function withPopup(answer: Answer, check: (fake: Fake) => Promise<void>, role: UserRole = "operator"): Promise<void> {
  signIn(role);
  const fake = installOnFakes({ summary: EMPTY_SUMMARY, ...answer }, useAuthStore);
  try {
    mount();
    await act(flush);
    await check(fake);
  } finally {
    cleanup();
    fake.uninstall();
    useAuthStore.setState({ accessToken: null, user: null });
    vi.restoreAllMocks();
  }
}

/** The server holds `list` now; the feed reads it. */
async function serverHolds(fake: Fake, list: readonly AlarmListItem[], summary?: AlarmSummaryResponse): Promise<void> {
  fake.answer(summary ? { list, summary } : { list });
  await act(async () => {
    alarmBarFeed()?.refreshNow();
    await flush();
  });
}

const popup = () => screen.queryByRole("region", { name: "New alarms" });
const rowMessages = () =>
  within(screen.getByRole("region", { name: "New alarms" }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector("span")?.textContent);

const warning = (over: Partial<AlarmListItem>) => alarmItem({ severity: "warning", severityRank: 20, ...over });

/** Decision 6 — rank 20 opens it, rank 25 (unseeded) opens it, rank 10 alone opens none. */
export async function opensAtRankTwentyAndAbove(): Promise<void> {
  await withPopup({ list: [alarmItem({ id: "i", severity: "info", severityRank: 10 })] }, async (f) => {
    expect(popup()).toBeNull();
    await serverHolds(f, [warning({ id: "w", message: "Warning one" })]);
    expect(rowMessages()).toEqual(["Warning one"]);
    await serverHolds(f, [alarmItem({ id: "u", severity: "urgent", severityRank: 25, message: "Urgent one" })]);
    expect(rowMessages()).toEqual(["Urgent one"]);
  });
}

/** Decision 7 — critical before warning, newest first in each; an arrival joins the one popup. */
export async function ordersByRankThenNewestAndAnArrivalJoins(): Promise<void> {
  const list = [
    warning({ id: "w1", message: "W old", raisedAt: "2026-11-12T08:00:00.000Z" }),
    alarmItem({ id: "c1", message: "C old", raisedAt: "2026-11-12T07:00:00.000Z" }),
    warning({ id: "w2", message: "W new", raisedAt: "2026-11-12T11:00:00.000Z" }),
  ];
  await withPopup({ list }, async (f) => {
    expect(rowMessages()).toEqual(["C old", "W new", "W old"]);
    await serverHolds(f, [...list, alarmItem({ id: "c2", message: "C new", raisedAt: "2026-11-12T12:00:00.000Z" })]);
    expect(screen.getAllByRole("region", { name: "New alarms" })).toHaveLength(1);
    expect(rowMessages()).toEqual(["C new", "C old", "W new", "W old"]);
    expect(within(popup()!).getByRole("heading").textContent).toBe("4 new alarms");
  });
}

/** Decision 8 — Close hides it; the alarm stays the bar's newest; a later new id pops up alone. */
const ONE_CRITICAL: AlarmSummaryResponse = {
  total: 1,
  items: [{ code: "critical", label: "Critical", tone: "critical", rank: 30, count: 1, unacknowledged: 1 }],
};

export async function closeHidesItAndOnlyANewAlarmReopensIt(): Promise<void> {
  await withPopup({ list: [alarmItem({ id: "a", message: "First" })], summary: ONE_CRITICAL }, async (f) => {
    await userEvent.setup().click(within(popup()!).getByRole("button", { name: "Close" }));
    expect(popup()).toBeNull();
    expect(screen.getByRole("region", { name: "Alarms" }).textContent).toContain("First");
    await serverHolds(f, [alarmItem({ id: "a", message: "First" }), alarmItem({ id: "b", message: "Second" })]);
    expect(rowMessages()).toEqual(["Second"]);
  });
}

/** Decision 21 — an in-app navigation keeps "seen"; a session end and a new sign-in bring the popup back. */
export async function seenSurvivesNavigationButNotASession(): Promise<void> {
  await withPopup({ list: [alarmItem({ id: "a", message: "First" })] }, async (f) => {
    await userEvent.setup().click(within(popup()!).getByRole("button", { name: "Close" }));
    cleanup();
    mount("/control-room/org/11111111-1111-4111-8111-111111111111");
    await act(flush);
    expect(f.listCalls.at(-1), "the new page read its own scope").toEqual({ organizationId: "11111111-1111-4111-8111-111111111111" });
    expect(popup(), "another page, the same tab").toBeNull();
    await act(async () => {
      f.session.setState({ accessToken: null, user: null });
      signIn("operator");
      await flush();
    });
    expect(rowMessages(), "a login treats it as unseen").toEqual(["First"]);
  });
}

/** Decision 18 — another operator's acknowledge, and a clear, take the row out. */
export async function rowsLeaveWhenAcknowledgedElsewhereOrCleared(): Promise<void> {
  const a = alarmItem({ id: "a", message: "First" });
  const b = alarmItem({ id: "b", message: "Second" });
  await withPopup({ list: [a, b] }, async (f) => {
    await serverHolds(f, [{ ...a, acknowledgedAt: "2026-11-12T12:00:00.000Z" }, b]);
    expect(rowMessages()).toEqual(["Second"]);
    await serverHolds(f, []);
    expect(popup()).toBeNull();
  });
}

/** Decision 8 — the reason rule, then one call per row in the shown order with the trimmed reason. */
export async function acknowledgeAllAsksOneReasonAndCallsInOrder(): Promise<void> {
  const list = [
    warning({ id: "w", message: "W" }),
    alarmItem({ id: "c", message: "C", raisedAt: "2026-11-12T09:00:00.000Z" }),
    alarmItem({ id: "c2", message: "C2", raisedAt: "2026-11-12T11:00:00.000Z" }),
  ];
  await withPopup({ list }, async (f) => {
    const user = userEvent.setup();
    await user.click(within(popup()!).getByRole("button", { name: "Acknowledge all" }));
    const reason = within(popup()!).getByLabelText(/Reason/);
    const confirm = within(popup()!).getByRole("button", { name: "Confirm" });
    expect(within(popup()!).getByText("This cannot be undone.")).toBeTruthy();
    await user.type(reason, "ok");
    expect((confirm as HTMLButtonElement).disabled, "two characters are too few").toBe(true);
    await user.clear(reason);
    await user.type(reason, "  Checked on site  ");
    f.answer({ list: [] });
    await act(async () => {
      await user.click(confirm);
      await flush();
    });
    expect(f.ackCalls).toEqual(["c2", "c", "w"].map((id) => ({ id, reason: "Checked on site" })));
  });
}

/** Decisions 8, 18 — a failed call keeps its row with its error, and the line reads "2 of 3 acknowledged". */
export async function aFailedRowStaysWithItsError(): Promise<void> {
  const list = [alarmItem({ id: "a", message: "A" }), alarmItem({ id: "b", message: "B" }), alarmItem({ id: "c", message: "C" })];
  await withPopup({ list }, async (f) => {
    f.refuseAcknowledge("b", "Alarm not found or outside your access scope");
    const user = userEvent.setup();
    await user.click(within(popup()!).getByRole("button", { name: "Acknowledge all" }));
    await user.type(within(popup()!).getByLabelText(/Reason/), "Checked on site");
    f.answer({ list: [list[1]!] });
    await act(async () => {
      await user.click(within(popup()!).getByRole("button", { name: "Confirm" }));
      await flush();
    });
    expect(within(popup()!).getByRole("status").textContent).toBe("2 of 3 acknowledged");
    expect(rowMessages()).toEqual(["B"]);
    expect(within(popup()!).getByText("Alarm not found or outside your access scope")).toBeTruthy();
  });
}

/** Decision 8 — a viewer sees Close and no Acknowledge. */
export async function aViewerSeesCloseOnly(): Promise<void> {
  await withPopup(
    { list: [alarmItem({ id: "a" })] },
    async () => {
      const region = popup()!;
      expect(within(region).getByRole("button", { name: "Close" })).toBeTruthy();
      expect(within(region).queryByRole("button", { name: /Acknowledge/ })).toBeNull();
    },
    "viewer",
  );
}

/** Decision 7, Q1 — beyond the 50 listed: "and N more active alarms", linked to the Alarm Centre. */
export async function namesTheAlarmsBeyondTheList(): Promise<void> {
  const list = Array.from({ length: 50 }, (_, i) => alarmItem({ id: `a${i}`, message: `Alarm ${i}` }));
  const summary: AlarmSummaryResponse = {
    total: 60,
    items: [
      { code: "info", label: "Info", tone: "info", rank: 10, count: 0, unacknowledged: 0 },
      { code: "critical", label: "Critical", tone: "critical", rank: 30, count: 60, unacknowledged: 60 },
    ],
  };
  await withPopup({ list, summary }, async () => {
    const link = within(popup()!).getByRole("link", { name: "and 10 more active alarms" });
    expect(link.getAttribute("href")).toBe("/alarms");
  });
}

/**
 * Code review (PR 3) — the reason form, the details panel and the run line belong to the popup that
 * opened them: a row that leaves while its form is open takes the form with it, and a popup that
 * hides and comes back for a new alarm opens clean, so Confirm can only send what is shown.
 */
export async function theFormAndTheRunLineDieWithTheirRows(): Promise<void> {
  const a = alarmItem({ id: "a", message: "A" });
  const b = alarmItem({ id: "b", message: "B" });
  await withPopup({ list: [a, b] }, async (f) => {
    const user = userEvent.setup();
    const rowOf = (message: string) => within(popup()!).getAllByRole("listitem").find((li) => li.textContent?.includes(message))!;
    await user.click(within(rowOf("A")).getByRole("button", { name: "Acknowledge" }));
    await user.type(within(popup()!).getByLabelText(/Reason/), "Checked on site");
    await serverHolds(f, [b]);
    expect(within(popup()!).queryByLabelText(/Reason/), "the form for a row that left is gone").toBeNull();
    await serverHolds(f, []);
    expect(popup()).toBeNull();
    await serverHolds(f, [alarmItem({ id: "c", message: "C" })]);
    expect(within(popup()!).queryByLabelText(/Reason/), "a new popup opens without a form").toBeNull();
    expect(within(popup()!).queryByRole("status"), "and without an old run line").toBeNull();
    expect(f.ackCalls).toEqual([]);
  });
}

/** Code review (PR 3) — the popup paints above an open All alarms list, so Close stays reachable. */
export async function thePopupComesAfterTheList(): Promise<void> {
  // F4.160: the list's read is stubbed, so nothing reaches a local API.
  vi.spyOn(alarmsApi, "fetchActiveAlarms").mockResolvedValue({ items: [], nextCursor: null });
  await withPopup({ list: [alarmItem({ id: "a" })] }, async () => {
    await userEvent.setup().click(screen.getByRole("button", { name: "All alarms" }));
    const list = document.getElementById("alarm-bar-list");
    expect(list, "the list is open").not.toBeNull();
    expect(list!.compareDocumentPosition(popup()!) & Node.DOCUMENT_POSITION_FOLLOWING, "the popup follows the list").toBeTruthy();
  });
}
