import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AlarmListItem, AlarmSeverityDto, VocabulariesResponse } from "@bms/shared";

import * as alarmsApi from "../api/alarms";
import * as vocabApi from "../api/vocabularies";
import type { AuthUser } from "../stores/auth-store";
import { AlarmsPage } from "./alarms-page";

/**
 * `F3.10` U9 — the alarm grid derives the four states of ADR 0057 decision 1.
 *
 * **Why this is a render test and not four more `src/lib` cases.**
 * `alarm-state.spec.ts` already proves the derivation. What it cannot prove is
 * that the page *uses* it — and the failure this file exists to catch is
 * exactly that shape: before `F3.10` the grid muted a row and hid its Ack
 * button on `acknowledgedAt`, so an acknowledged alarm whose breach still held
 * read as finished. A pure-function test passes against a page that ignores
 * the function (ADR 0042's own argument, and AGENTS.md §4.4's).
 *
 * The two summary counts are here for the same reason. `Active` now means
 * *uncleared*, so it counts the acknowledged-but-breaching alarm — the number
 * moved without the card's markup moving, which is the kind of change a
 * compiler is silent about.
 */

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

/**
 * The page opens a Socket.IO connection on mount (`/ws/alarms`). A unit test
 * has no business dialling one, and an unmocked `io()` leaves a live reconnect
 * timer behind that outlives the test — so the transport is replaced whole.
 * `on` and `disconnect` are the only two members the page touches.
 */
vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    disconnect: () => undefined,
  }),
}));

const SEVERITIES: AlarmSeverityDto[] = [
  { code: "info", label: "Info", tone: "info", rank: 10, active: true },
  { code: "critical", label: "Critical", tone: "critical", rank: 30, active: true },
];

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: SEVERITIES,
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
} as unknown as VocabulariesResponse;

const ACK_AT = "2026-09-06T09:30:00.000Z";
const CLEARED_AT = "2026-09-06T09:45:00.000Z";

function alarm(overrides: Partial<AlarmListItem>): AlarmListItem {
  return {
    id: "a0",
    assetId: "as0",
    ruleKey: null,
    ruleId: "r0",
    severity: "critical",
    message: "Voltage above limit",
    raisedAt: "2026-09-06T09:00:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    assetCode: "GEN-01",
    assetName: "Generator One",
    siteName: "Plant A",
    ...overrides,
  };
}

/**
 * One row per state, and the severities are chosen so that no severity card
 * also reads `2` — Critical 3, Minor 1, Major 0 against Active 2 and
 * Acknowledged 2. A red run then names the card it means.
 */
const ACTIVE = alarm({ id: "a1", message: "Voltage above limit" });
const ACKNOWLEDGED = alarm({
  id: "a2",
  message: "Current above limit",
  acknowledgedAt: ACK_AT,
  acknowledgedBy: "operator@bms.local",
});
const CLEARED_UNACK = alarm({
  id: "a3",
  message: "Frequency above limit",
  clearedAt: CLEARED_AT,
});
const CLOSED = alarm({
  id: "a4",
  severity: "info",
  message: "Humidity above limit",
  acknowledgedAt: ACK_AT,
  acknowledgedBy: "operator@bms.local",
  clearedAt: CLEARED_AT,
});

const FOUR_STATES: AlarmListItem[] = [ACTIVE, ACKNOWLEDGED, CLEARED_UNACK, CLOSED];

async function renderPage(items: AlarmListItem[] = FOUR_STATES): Promise<void> {
  vi.spyOn(alarmsApi, "fetchAlarmsPage").mockResolvedValue({ items, nextCursor: null });
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AlarmsPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // The grid replaces the loading line once the first page resolves.
  await screen.findByRole("table");
}

/**
 * A summary card, found by the label a person reads.
 *
 * `Active` and `Acknowledged` are each on a card *and* in a row's State cell,
 * so the table is excluded rather than the query being made more specific:
 * narrowing by class or position would be the assertion-on-markup ADR 0042
 * decision 5 forbids.
 */
function summaryCard(label: string): HTMLElement {
  const table = screen.getByRole("table");
  const outside = screen.getAllByText(label).filter((node) => !table.contains(node));
  if (outside.length !== 1) {
    throw new Error(`expected one "${label}" card outside the grid, found ${outside.length}`);
  }
  const card = outside[0].parentElement;
  if (!card) {
    throw new Error(`the "${label}" card label has no card around it`);
  }
  return card;
}

/** One alarm row, addressed by the message an operator would scan for. */
function rowFor(message: string): HTMLElement {
  return within(screen.getByRole("table")).getByRole("row", {
    name: new RegExp(message),
  });
}

/** Decision 1: four states, and each one says what it is. */
export async function rendersAllFourLifecycleStates(): Promise<void> {
  await renderPage();

  expect(within(rowFor("Voltage above limit")).getByText("Active")).toBeInTheDocument();
  expect(within(rowFor("Current above limit")).getByText("Acknowledged")).toBeInTheDocument();
  expect(
    within(rowFor("Frequency above limit")).getByText("Cleared — unacknowledged"),
  ).toBeInTheDocument();
  expect(within(rowFor("Humidity above limit")).getByText("Closed")).toBeInTheDocument();
}

/**
 * The count that reverses: *Active* is `cleared_at IS NULL`, so it includes
 * the acknowledged-but-still-breaching alarm and excludes the cleared,
 * unacknowledged one. Before `F3.10` this card read 2 as well — but the other
 * two rows. Both cards are asserted so the pair cannot silently swap meaning.
 */
export async function countsActiveAsUnclearedAndAcknowledgedAsStamped(): Promise<void> {
  await renderPage();

  expect(within(summaryCard("Active")).getByText("2")).toBeInTheDocument();
  expect(within(summaryCard("Acknowledged")).getByText("2")).toBeInTheDocument();
  // The severity cards are unrelated to the lifecycle and must not have moved.
  expect(within(summaryCard("Critical")).getByText("3")).toBeInTheDocument();
  expect(within(summaryCard("Minor")).getByText("1")).toBeInTheDocument();
}

/**
 * `POST /alarms/:id/ack` accepts any alarm with `acknowledged_at IS NULL`, a
 * cleared one included — that press is the transition to *closed*. The button
 * follows that predicate and not the clear stamp.
 */
export async function offersAckOnExactlyTheUnacknowledgedRows(): Promise<void> {
  await renderPage();

  expect(
    within(rowFor("Voltage above limit")).getByRole("button", { name: "Ack" }),
  ).toBeInTheDocument();
  expect(
    within(rowFor("Frequency above limit")).getByRole("button", { name: "Ack" }),
  ).toBeInTheDocument();
  expect(
    within(rowFor("Current above limit")).queryByRole("button", { name: "Ack" }),
  ).toBeNull();
  expect(
    within(rowFor("Humidity above limit")).queryByRole("button", { name: "Ack" }),
  ).toBeNull();
}

/**
 * Searching `cleared` returns both alarms that carry a clear stamp.
 *
 * *Closed* does not contain the substring "cleared" and would be dropped by a
 * search built from the label alone — which is the reading an operator would
 * least expect, since a closed alarm is a cleared one that was also
 * acknowledged.
 */
export async function searchingClearedKeepsBothClearedRows(): Promise<void> {
  await renderPage();

  await userEvent.type(
    screen.getByPlaceholderText("Asset, site, severity, subsystem..."),
    "cleared",
  );

  expect(screen.getByText("2 of 4 loaded alarms shown")).toBeInTheDocument();
  const table = screen.getByRole("table");
  expect(within(table).getByText("Frequency above limit")).toBeInTheDocument();
  expect(within(table).getByText("Humidity above limit")).toBeInTheDocument();
  expect(within(table).queryByText("Voltage above limit")).toBeNull();
  expect(within(table).queryByText("Current above limit")).toBeNull();
}
