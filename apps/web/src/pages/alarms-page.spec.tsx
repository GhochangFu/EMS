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
import * as copilotApi from "../api/copilot";

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
  waterBalanceRoles: [],
  switchingStates: [],
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
    assetRtuName: "RTU 1",
    assetLocationName: "Plant A",
    assetName: "Generator One",
    siteName: "Plant A",
    source: "rule",
    rtuId: null,
    rtuCode: null,
    severityRank: 30,
    locationName: null,
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
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
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

/**
 * `F4.204` — a refused acknowledgement shows the server's sentence.
 *
 * `ackAlarm` throws `new Error(text)` where `text` is the whole response body,
 * so before this row the ack dialog's alert rendered the Nest envelope
 * (`{"statusCode":409,...}`) verbatim. The alert is asserted by its text, which
 * only exists after the mutation has rejected.
 */
export async function ackRefusalShowsTheServerSentence(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no fetch expected"))),
  );
  const sentence = "This alarm was already acknowledged by another operator.";
  vi.spyOn(alarmsApi, "ackAlarm").mockRejectedValue(
    new Error(JSON.stringify({ statusCode: 409, message: sentence, error: "Conflict" })),
  );
  await renderPage();

  await userEvent.click(
    within(rowFor("Voltage above limit")).getByRole("button", { name: "Ack" }),
  );
  // `F4.284`: the Ack is a Reason → Review `WizardShell` (ADR 0106, owner ruling Q9).
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Reason (required)"), "Verified at panel");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  // The fixture's alarm id is no UUID, so the shell also warns that the copilot cannot fill it.
  const alert = (await within(dialog).findAllByRole("alert")).find((node) => node.textContent?.includes(sentence));
  expect(alert).toHaveTextContent(sentence);
  expect(alert?.textContent).not.toContain('{"');
}

/** `F4.284`: a reason that trims below 3 characters stays on the Reason step (the old dialog's rule). */
export async function aReasonThatTrimsShortStaysOnTheReasonStep(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no fetch expected"))),
  );
  await renderPage();
  await userEvent.click(within(rowFor("Voltage above limit")).getByRole("button", { name: "Ack" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Reason (required)"), "ok ");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(within(dialog).queryByRole("button", { name: "Submit" })).toBeNull();
}

/** `F4.284`: the reason sent is the trimmed one the Review card shows. */
export async function theAckSendsTheTrimmedReason(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no fetch expected"))),
  );
  const ack = vi.spyOn(alarmsApi, "ackAlarm").mockRejectedValue(new Error("refused"));
  await renderPage();
  await userEvent.click(within(rowFor("Voltage above limit")).getByRole("button", { name: "Ack" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Reason (required)"), "  Verified at panel  ");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(ack.mock.calls[0]?.[1]).toBe("Verified at panel");
}

/**
 * `F4.316` PR 2 (ADR 0111): the innermost element whose whole text is `text` — the asset label is
 * the code and a `· where` span, so no single text node holds it.
 */
function byWholeText(container: HTMLElement, text: string): HTMLElement {
  return within(container).getByText(
    (_content, element) =>
      element !== null &&
      element.textContent === text &&
      Array.from(element.children).every((child) => child.textContent !== text),
  );
}

/** `F4.316` PR 2 (ADR 0111): the Asset cell reads `<code> · <RTU>`. */
export async function theAssetCellNamesTheRtu(): Promise<void> {
  await renderPage([alarm({ id: "a1", assetCode: "CR-Q1", message: "Voltage above limit" })]);
  expect(byWholeText(rowFor("Voltage above limit"), "CR-Q1 · RTU 1")).toBeInTheDocument();
}

/** With no RTU the location names the asset: `<code> · <location>`. */
export async function theAssetCellFallsBackToTheLocation(): Promise<void> {
  await renderPage([alarm({ id: "a1", assetCode: "CR-Q1", assetRtuName: null, message: "Voltage above limit" })]);
  expect(byWholeText(rowFor("Voltage above limit"), "CR-Q1 · Plant A")).toBeInTheDocument();
}

/** The `· where` part wraps rather than truncating (ADR 0111 decision on long RTU names). */
export async function theAssetCellsWherePartWraps(): Promise<void> {
  await renderPage([alarm({ id: "a1", assetCode: "CR-Q1", message: "Voltage above limit" })]);
  const where = within(rowFor("Voltage above limit")).getByText("· RTU 1");
  expect(where).not.toHaveClass("truncate");
  expect(where).toHaveClass("whitespace-normal");
}

/* -------------------------------------------------------------------------- */
/* F3.16 (plan B6, ADR 0127 decisions 12 and 14) — device alarms in the grid    */
/* -------------------------------------------------------------------------- */

const DEVICE_FIELDS = {
  assetId: null,
  assetCode: null,
  assetRtuName: null,
  assetLocationName: null,
  assetName: null,
  siteName: null,
  ruleId: null,
} as const;
const RTU_ALARM = alarm({
  id: "d1",
  ...DEVICE_FIELDS,
  severity: "info",
  message: "Communication lost: Pump house RTU",
  source: "rtu_comms",
  rtuId: "rtu-7",
  rtuCode: "RTU-07",
});
const HOST_ALARM = alarm({
  id: "d2",
  ...DEVICE_FIELDS,
  message: "Ingest host not reporting",
  source: "ingest_host",
});
const RULE_ALARM = alarm({ id: "a1", assetCode: "CR-Q1", message: "Voltage above limit" });

/** The Asset cell names the RTU (`RTU <code>`) or the ingest host where an asset would be. */
export async function aDeviceAlarmNamesItsRtuOrTheIngestHost(): Promise<void> {
  await renderPage([RTU_ALARM, HOST_ALARM, RULE_ALARM]);
  expect(byWholeText(rowFor("Communication lost"), "RTU RTU-07")).toBeInTheDocument();
  expect(byWholeText(rowFor("Ingest host not reporting"), "Ingest host")).toBeInTheDocument();
  expect(byWholeText(rowFor("Voltage above limit"), "CR-Q1 · RTU 1"), "a rule alarm renders as before").toBeInTheDocument();
  for (const message of ["Communication lost", "Ingest host not reporting"]) {
    expect(rowFor(message).textContent, "no null leaks into a device row").not.toMatch(/null/);
  }
}

/** A work order needs an asset, so a device row offers none; Details and Ack stay. */
export async function aDeviceAlarmHidesTheAssetOnlyActions(): Promise<void> {
  await renderPage([RTU_ALARM, HOST_ALARM, RULE_ALARM]);
  for (const message of ["Communication lost", "Ingest host not reporting"]) {
    const row = rowFor(message);
    expect(within(row).queryByRole("button", { name: "Work order" }), `${message}: no work order`).toBeNull();
    expect(within(row).getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Ack" })).toBeInTheDocument();
  }
  expect(within(rowFor("Voltage above limit")).getByRole("button", { name: "Work order" })).toBeInTheDocument();
}

/** Acknowledging a device alarm sends its id, and the Review card names the device. */
export async function aDeviceAlarmIsAcknowledged(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no fetch expected"))),
  );
  const ack = vi.spyOn(alarmsApi, "ackAlarm").mockResolvedValue({ ...RTU_ALARM, acknowledgedAt: ACK_AT });
  await renderPage([RTU_ALARM, RULE_ALARM]);
  await userEvent.click(within(rowFor("Communication lost")).getByRole("button", { name: "Ack" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Reason (required)"), "RTU power restored");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(within(dialog).getByText(/on RTU RTU-07, raised/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(ack.mock.calls[0]?.slice(0, 2)).toEqual(["d1", "RTU power restored"]);
}

/**
 * `F3.16` review fix — a device alarm is a communications fault, so the subsystem split files it
 * under IT by its `source`, never by its message: the comms message names a battery RTU, which
 * the text match would file under Battery, and the host alarm would fall through to Security.
 */
export async function aDeviceAlarmCountsUnderIt(): Promise<void> {
  const batteryRtu = { ...RTU_ALARM, message: "Communication lost: Battery room RTU" };
  await renderPage([batteryRtu, HOST_ALARM, RULE_ALARM]);
  const countOf = (subsystem: string) => {
    const label = screen.getAllByText(subsystem, { exact: true }).find((node) => !screen.getByRole("table").contains(node));
    return label?.parentElement?.textContent?.replace(subsystem, "").trim();
  };
  expect(countOf("IT"), "both device alarms are IT").toBe("2 / 3");
  expect(countOf("Battery"), "the comms message names a battery RTU, not a battery").toBe("0 / 3");
  expect(countOf("Security"), "only the rule alarm falls through").toBe("1 / 3");
}
