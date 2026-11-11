import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { WorkOrderDetail, WorkOrderListItem } from "@bms/shared";

import * as assetsApi from "../api/assets";
import * as workOrdersApi from "../api/work-orders";
import type { AuthUser } from "../stores/auth-store";
import { APPROVE_NEEDS_ADMIN, APPROVE_NEEDS_RESOLVED, priorityRailStyle, priorityStyle, WorkOrdersPage } from "./work-orders-page";
import * as copilotApi from "../api/copilot";
import { ROOT_CAUSE_REQUIRED } from "../components/work-orders/work-order-status-wizard";

/**
 * `F3.65b` owner ruling R-f (2026-09-28) — priority `high` and `medium` must not
 * look the same. The palette migration merged both onto the warning pill; the
 * ruling splits them again with existing roles only: `high` takes the solid
 * warning line and the strong wash, `medium` the soft line and the plain wash;
 * the kanban card's left rail is solid for `high` and half-opacity for `medium`.
 *
 * Assertions live here; `work-orders-page.test.tsx` is the Vitest entry point
 * (ADR 0014).
 */

export function highAndMediumPillsDiffer(): void {
  expect(priorityStyle("high")).not.toBe(priorityStyle("medium"));
}

export function highPillIsTheRuledStrongWarning(): void {
  expect(priorityStyle("high")).toBe("border-warning bg-warning-wash-strong text-warning-ink");
}

export function mediumPillIsTheRuledSoftWarning(): void {
  expect(priorityStyle("medium")).toBe("border-warning-line bg-warning-wash text-warning-ink");
}

export function highAndMediumRailsDiffer(): void {
  expect(priorityRailStyle("high")).not.toBe(priorityRailStyle("medium"));
}

export function mediumRailIsTheHalfOpacityWarning(): void {
  expect(priorityRailStyle("medium")).toBe("border-l-warning/50");
}

/**
 * `F4.204` — the `api/work-orders` writers throw an `Error` whose message is the
 * whole response body, so a refusal read through `err.message` showed
 * `{"statusCode":409,…}` on the page. Each of the four write sites reads it
 * through `apiErrorMessage`; one case per site, because a site left on the raw
 * read reddens only its own case. Each case refuses with its own sentence, and
 * finds the error element by that sentence — never by an element that renders
 * before the refusal.
 */

/**
 * The page's `AppShell` opens a Socket.IO connection on mount; a unit test has
 * no business dialling one (the `alarms-page.spec.tsx` precedent).
 */
vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    off: () => undefined,
    emit: () => undefined,
    disconnect: () => undefined,
  }),
}));

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const ROW: WorkOrderListItem = {
  id: "0f4e1d2c-0000-4000-8000-000000000001",
  assetId: "0f4e1d2c-0000-4000-8000-0000000000a1",
  alarmId: null,
  title: "Replace pump bearing",
  description: null,
  status: "open",
  priority: "medium",
  sortOrder: 0,
  assignedTo: null,
  createdBy: null,
  dueAt: null,
  resolvedAt: null,
  closedAt: null,
  reference: "GEN-000001",
  slaMinutes: null,
  slaDueAt: null,
  slaState: "none",
  checklistDone: 0,
  checklistTotal: 0,
  causeCode: null,
  approvedAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
  assetCode: "PMP-01",
  assetRtuName: "RTU 2",
  assetLocationName: "Plant A",
  assetName: "Pump One",
  siteName: "Plant A",
};

/** `E3.1` (ADR 0122 decision 6.5): only a resolved ticket is approved and closed. */
const RESOLVED_ROW: WorkOrderListItem = { ...ROW, status: "resolved", resolvedAt: "2026-10-01T10:00:00.000Z" };

const ASSET = {
  id: "0f4e1d2c-0000-4000-8000-0000000000a1",
  code: "PMP-01",
  name: "Pump One",
  siteName: "Plant A",
} as unknown as assetsApi.AssetRow;

function envelope(sentence: string): Error {
  return new Error(`{"statusCode":409,"message":"${sentence}","error":"Conflict"}`);
}

/**
 * `F4.209` commit bound (WO5 below). The bound must stay below React's
 * 50-nested-passive-update warning, so a mutation run ends before the console
 * floods. A settled page commits only a handful of times while it loads.
 */
const COMMIT_BOUND = 20;

/** Thrown by the `Profiler` past the bound; any other error is not the bound. */
class CommitBoundExceeded extends Error {}

/**
 * Renders the page with no cache seed. Until the row paints, a `Profiler` throws
 * past `COMMIT_BOUND`: a `[rows]` render loop (F4.209) runs synchronously inside
 * `act` from mount, so without the guard a regression hangs the worker at the
 * first case instead of failing it. The guard disarms once the row is on screen,
 * because the cases' own typing and dragging commit many more times.
 */
async function renderPage(shown: WorkOrderListItem | WorkOrderListItem[] = ROW, as: AuthUser = user): Promise<void> {
  const rows = Array.isArray(shown) ? shown : [shown];
  const row = rows[0] as WorkOrderListItem;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("work-orders-page.spec: no fetch expected"))),
  );
  vi.spyOn(workOrdersApi, "fetchWorkOrders").mockResolvedValue({ items: rows });
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([ASSET]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let armed = true;
  let commits = 0;
  const onRender = (): void => {
    commits += 1;
    if (armed && commits > COMMIT_BOUND) {
      throw new CommitBoundExceeded(`the page committed ${commits} times`);
    }
  };
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <Profiler id="work-orders" onRender={onRender}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkOrdersPage user={as} />
        </MemoryRouter>
      </QueryClientProvider>
    </Profiler>,
  );
  await screen.findByText(row.title);
  armed = false;
}

/** The element carrying the refusal, found by its sentence; it must not carry the JSON. */
async function expectTheSentenceNotTheEnvelope(sentence: string): Promise<void> {
  const element = await screen.findByText(new RegExp(sentence));
  expect(element.textContent).toContain(sentence);
  expect(element.textContent).not.toContain('{"');
}

const CREATE_SENTENCE = "An open work order already exists for this alarm";
const STATUS_SENTENCE = "A closed work order cannot change status";
const CLOSE_SENTENCE = "This work order was already closed by another user";
const REORDER_SENTENCE = "The board changed while you were dragging";

/** A refused work-order create shows the server sentence, not the JSON envelope. */
export async function aRefusedCreateShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "createWorkOrder").mockRejectedValue(envelope(CREATE_SENTENCE));
  await renderPage();
  await screen.findByRole("option", { name: "PMP-01 · Pump One" });

  await userEvent.click(screen.getByRole("button", { name: "+ New WO" }));
  const dialog = await screen.findByRole("dialog", { name: "Create work order" });
  await userEvent.type(within(dialog).getByLabelText("Title"), "Check pump");
  // `F4.284`: Work → Assignment → Review on the shared `WizardShell`.
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  await expectTheSentenceNotTheEnvelope(CREATE_SENTENCE);
}

/** A refused status change shows the server sentence, not the JSON envelope. */
export async function aRefusedStatusChangeShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "updateWorkOrderStatus").mockRejectedValue(envelope(STATUS_SENTENCE));
  await renderPage();

  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit status" });
  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "assigned");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  await expectTheSentenceNotTheEnvelope(STATUS_SENTENCE);
}

/** A refused close shows the server sentence, not the JSON envelope. */
export async function aRefusedCloseShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "closeWorkOrder").mockRejectedValue(envelope(CLOSE_SENTENCE));
  await renderPage(RESOLVED_ROW);

  await userEvent.click(screen.getByRole("button", { name: "Approve and close" }));
  const dialog = await screen.findByRole("dialog", { name: "Approve and close work order" });
  await userEvent.type(within(dialog).getByLabelText("Approval note"), "Bearing replaced");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  await expectTheSentenceNotTheEnvelope(CLOSE_SENTENCE);
}

/** A refused board reorder shows the server sentence, not the JSON envelope. */
export async function aRefusedReorderShowsTheSentence(): Promise<void> {
  const reorder = vi
    .spyOn(workOrdersApi, "reorderWorkOrders")
    .mockRejectedValue(envelope(REORDER_SENTENCE));
  await renderPage();

  const card = screen.getByText(ROW.title).closest("article");
  if (!card) {
    throw new Error("the work-order card has no <article> around its title");
  }
  // The first empty column is Assigned: the Open column holds the one row.
  const assignedColumn = screen.getAllByText("Drop work orders here")[0];
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(assignedColumn, { dataTransfer });
  fireEvent.drop(assignedColumn, { dataTransfer });

  await expectTheSentenceNotTheEnvelope(REORDER_SENTENCE);
  // The adjacent positive: the drop reached the reorder writer, not the close dialog.
  expect(reorder).toHaveBeenCalledTimes(1);
}

/**
 * Waits until `count()` holds the same value for `STABLE_TURNS` macrotask turns in
 * a row, so a loop that starts only after the error paints is still counted: a
 * running loop never holds still, and the turn cap then ends the wait.
 */
const STABLE_TURNS = 5;
const MAX_TURNS = 200;
async function settle(count: () => number): Promise<void> {
  let last = -1;
  let stable = 0;
  for (let turn = 0; turn < MAX_TURNS && stable < STABLE_TURNS; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const now = count();
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
}

/**
 * `F4.209` — while the list query has no data, `rows` must be a stable reference,
 * or the page's `[rows]` effect sets a fresh `[]` into state on every commit and
 * the page re-renders without end. React only warns on that loop (it does not
 * throw), and under RTL's `render` the loop runs inside `act`, which drains it
 * synchronously from mount: `render` never returns, no microtask runs, and no
 * test timeout can fire. So a `Profiler` counts commits and *throws* past the
 * bound. React catches a commit-phase throw with no error boundary by unmounting
 * the root and rethrowing it out of `act`; the loop dies with the tree, `render`
 * returns, and the case reddens on the bound.
 *
 * `COMMIT_BOUND` and `CommitBoundExceeded` sit above `renderPage`, which arms the
 * same guard for WO1–WO4 until the row paints.
 *
 * A failed list read with no cache seed shows the error and stops committing.
 */
export async function aFailedListReadSettles(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("work-orders-page.spec: no fetch expected"))),
  );
  vi.spyOn(workOrdersApi, "fetchWorkOrders").mockRejectedValue(
    new Error('{"statusCode":500,"message":"Internal server error"}'),
  );
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([ASSET]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  let commits = 0;
  const onRender = (): void => {
    commits += 1;
    if (commits > COMMIT_BOUND) {
      throw new CommitBoundExceeded(`the page committed ${commits} times`);
    }
  };

  let boundExceeded = false;
  try {
    vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
    render(
      <Profiler id="work-orders" onRender={onRender}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <WorkOrdersPage user={user} />
          </MemoryRouter>
        </QueryClientProvider>
      </Profiler>,
    );
  } catch (error) {
    if (!(error instanceof CommitBoundExceeded)) {
      throw error;
    }
    boundExceeded = true;
  }

  if (!boundExceeded) {
    await screen.findByText("Could not load work orders.", {}, { timeout: 2000 });
    await settle(() => commits);
  }
  expect(commits).toBeLessThanOrEqual(COMMIT_BOUND);
}

/** `F4.284` (ADR 0106 decision 2): the status wizard never offers `closed` — a close has its own wizard. */
export async function theStatusWizardOffersNoClosed(): Promise<void> {
  await renderPage();
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit status" });
  const options = within(within(dialog).getByLabelText("New status")).getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
  expect(options).toEqual(["open", "assigned", "in_progress", "resolved"]);
}

/** `F4.284` (ADR 0106 decision 4): the close's Review card is red and says it cannot be undone. */
export async function theCloseReviewSaysItCannotBeUndone(): Promise<void> {
  await renderPage(RESOLVED_ROW);
  await userEvent.click(screen.getByRole("button", { name: "Approve and close" }));
  const dialog = await screen.findByRole("dialog", { name: "Approve and close work order" });
  await userEvent.type(within(dialog).getByLabelText("Approval note"), "Bearing replaced");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(within(dialog).getByText("This cannot be undone.")).toBeTruthy();
}

/** `F4.284`: a closure reason that trims below 3 characters stays on the Reason step. */
export async function aCloseReasonThatTrimsShortStaysOnTheReasonStep(): Promise<void> {
  await renderPage(RESOLVED_ROW);
  await userEvent.click(screen.getByRole("button", { name: "Approve and close" }));
  const dialog = await screen.findByRole("dialog", { name: "Approve and close work order" });
  await userEvent.type(within(dialog).getByLabelText("Approval note"), "ok ");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(within(dialog).queryByRole("button", { name: "Submit" })).toBeNull();
}

/**
 * `F4.316` PR 4a (ADR 0111): the innermost element whose whole text is `text` — the asset label is
 * the code and a `· where` span, so no single text node holds it.
 */
function byWholeText(text: string): HTMLElement {
  return screen.getByText(
    (_content, element) =>
      element !== null &&
      element.textContent === text &&
      Array.from(element.children).every((child) => child.textContent !== text),
  );
}

/** The card's asset line reads `<code> · <RTU>`. */
export async function theCardNamesTheRtu(): Promise<void> {
  await renderPage();
  expect(byWholeText("PMP-01 · RTU 2")).toBeInTheDocument();
}

/** With no RTU the location names the asset: `<code> · <location>`. */
export async function theCardFallsBackToTheLocation(): Promise<void> {
  await renderPage({ ...ROW, assetRtuName: null });
  expect(byWholeText("PMP-01 · Plant A")).toBeInTheDocument();
}

/** The `· where` part wraps rather than truncating. */
export async function theCardsWherePartWraps(): Promise<void> {
  await renderPage();
  const where = screen.getByText("· RTU 2");
  expect(where).not.toHaveClass("truncate");
  expect(where).toHaveClass("whitespace-normal");
}

/**
 * `E3.1` (ADR 0122 decision 5 and ruling P1; plan T4.4) — the status wizard's Root cause
 * section, and a drop on Review that opens the wizard instead of calling reorder.
 */
const ALARM_ROW: WorkOrderListItem = { ...ROW, alarmId: "0f4e1d2c-0000-4000-8000-0000000000b1", title: "Breaker tripped on feeder 2" };

const NO_FINDINGS = { events: [], alarm: null, tasks: [], rootCause: null, correctiveAction: null, preventiveAction: null, resolvedBy: null, approvedBy: null, cancelledBy: null, cancelledAt: null, alarmSnapshot: null };

/** Renders the page and stubs the two reads the Root cause section makes. */
async function renderForRootCause(row: WorkOrderListItem, detail: Partial<WorkOrderDetail> = {}): Promise<void> {
  await renderPage(row);
  vi.spyOn(workOrdersApi, "fetchWorkOrderDetail").mockResolvedValue({ ...row, ...NO_FINDINGS, ...detail } as WorkOrderDetail);
  vi.spyOn(workOrdersApi, "fetchWorkOrderCauseCodes").mockResolvedValue({
    items: [
      { code: "equipment_failure", label: "Equipment failure", sortOrder: 10 },
      { code: "wear_and_tear", label: "Wear and tear", sortOrder: 20 },
    ],
  });
}

async function openStatusWizard(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  return screen.findByRole("dialog", { name: "Edit status" });
}

/** Choosing `resolved` on an alarm ticket shows the Root cause section with its four fields; another status shows none. */
export async function choosingResolvedShowsTheRootCauseSection(): Promise<void> {
  await renderForRootCause(ALARM_ROW);
  const dialog = await openStatusWizard();
  expect(within(dialog).queryByRole("group", { name: "Root cause" }), "not shown for an open ticket").toBeNull();

  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "resolved");
  const section = within(dialog).getByRole("group", { name: "Root cause" });
  for (const label of ["Cause found", "Corrective action", "Preventive action", "Cause code"]) {
    expect(within(section).getByLabelText(label), label).toBeTruthy();
  }
  await within(section).findByRole("option", { name: "Wear and tear" });

  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "in_progress");
  expect(within(dialog).queryByRole("group", { name: "Root cause" }), "gone again for another status").toBeNull();
}

/** An alarm ticket cannot leave the step for `resolved` without the three findings: Next stays and says why. */
export async function anAlarmTicketCannotLeaveTheStepWithoutItsFindings(): Promise<void> {
  const save = vi.spyOn(workOrdersApi, "updateWorkOrderStatus");
  await renderForRootCause(ALARM_ROW);
  const dialog = await openStatusWizard();
  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "resolved");
  await within(dialog).findByRole("option", { name: "Wear and tear" });

  await userEvent.type(within(dialog).getByLabelText("Cause found"), "Contacts worn");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain(ROOT_CAUSE_REQUIRED);
  expect(within(dialog).queryByRole("button", { name: "Submit" }), "still on the Status step").toBeNull();
  expect(save).not.toHaveBeenCalled();
}

/** The findings typed in the section ride the same status write. */
export async function theFindingsAreSentWithTheResolve(): Promise<void> {
  const save = vi.spyOn(workOrdersApi, "updateWorkOrderStatus").mockResolvedValue({ ...ALARM_ROW, status: "resolved" });
  await renderForRootCause(ALARM_ROW);
  const dialog = await openStatusWizard();
  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "resolved");
  await within(dialog).findByRole("option", { name: "Wear and tear" });
  await userEvent.type(within(dialog).getByLabelText("Cause found"), "Contacts worn");
  await userEvent.type(within(dialog).getByLabelText("Corrective action"), "Contacts replaced");
  await userEvent.selectOptions(within(dialog).getByLabelText("Cause code"), "wear_and_tear");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Submit" }));

  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[0]).toEqual({
    id: ALARM_ROW.id,
    status: "resolved",
    rootCause: "Contacts worn",
    correctiveAction: "Contacts replaced",
    causeCode: "wear_and_tear",
  });
}

/** Findings already saved on the ticket count: the step can be left with nothing typed, and nothing is re-sent. */
export async function findingsAlreadySavedAreNotAskedForAgain(): Promise<void> {
  const save = vi.spyOn(workOrdersApi, "updateWorkOrderStatus").mockResolvedValue({ ...ALARM_ROW, status: "resolved" });
  await renderForRootCause(
    { ...ALARM_ROW, causeCode: "wear_and_tear" },
    { rootCause: "Contacts worn", correctiveAction: "Contacts replaced", causeCode: "wear_and_tear" },
  );
  const dialog = await openStatusWizard();
  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "resolved");
  await within(dialog).findByPlaceholderText("Contacts worn");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Submit" }));
  expect(save.mock.calls[0]?.[0]).toEqual({ id: ALARM_ROW.id, status: "resolved" });
}

/** A planned ticket (no alarm) may leave the step for `resolved` with no findings. */
export async function aPlannedTicketResolvesWithoutFindings(): Promise<void> {
  await renderForRootCause(ROW);
  const dialog = await openStatusWizard();
  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "resolved");
  expect(within(dialog).getByRole("group", { name: "Root cause" }).textContent).toContain("Optional for planned work.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(await within(dialog).findByRole("button", { name: "Submit" })).toBeTruthy();
}

/** A card dropped on Review opens the status wizard on `resolved` and calls no reorder (ruling P1). */
export async function aDropOnReviewOpensTheWizardAndCallsNoReorder(): Promise<void> {
  const reorder = vi.spyOn(workOrdersApi, "reorderWorkOrders");
  await renderForRootCause(ALARM_ROW);

  const card = screen.getByText(ALARM_ROW.title).closest("article");
  if (!card) {
    throw new Error("the work-order card has no <article> around its title");
  }
  // The empty columns, in board order: Assigned, In progress, Review, Done.
  const reviewColumn = screen.getAllByText("Drop work orders here")[2];
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(reviewColumn, { dataTransfer });
  fireEvent.drop(reviewColumn, { dataTransfer });

  const dialog = await screen.findByRole("dialog", { name: "Edit status" });
  expect((within(dialog).getByLabelText("New status") as HTMLSelectElement).value).toBe("resolved");
  expect(within(dialog).getByRole("group", { name: "Root cause" })).toBeTruthy();
  expect(reorder).not.toHaveBeenCalled();
}

/** Findings typed for `resolved` are dropped when the status moves to another value: they are not sent with it. */
export async function findingsAreNotSentWithAnotherStatus(): Promise<void> {
  const save = vi.spyOn(workOrdersApi, "updateWorkOrderStatus").mockResolvedValue({ ...ALARM_ROW, status: "in_progress" });
  await renderForRootCause(ALARM_ROW);
  const dialog = await openStatusWizard();
  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "resolved");
  await userEvent.type(within(dialog).getByLabelText("Cause found"), "Contacts worn");
  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "in_progress");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Submit" }));
  expect(save.mock.calls[0]?.[0]).toEqual({ id: ALARM_ROW.id, status: "in_progress" });
}

/**
 * `E3.1` (ADR 0122 decisions 6.2, 6.5 and 6.8; plan T5.5) — the board with approval and
 * with a cancelled ticket: who sees Approve and close enabled, on which row, and what a
 * drag sends when a cancelled row is in the list.
 */
const OPERATOR: AuthUser = { ...user, id: "u2", email: "operator@bms.local", displayName: "Operator", role: "operator" } as AuthUser;
const CANCELLED_ROW: WorkOrderListItem = {
  ...ROW,
  id: "0f4e1d2c-0000-4000-8000-000000000002",
  title: "Raised by mistake",
  reference: "GEN-000002",
  status: "cancelled",
};

function approveButton(title: string): HTMLButtonElement {
  const card = screen.getByText(title).closest("article");
  if (!card) {
    throw new Error(`no card for ${title}`);
  }
  return within(card as HTMLElement).getByRole("button", { name: "Approve and close" }) as HTMLButtonElement;
}

/** An admin sees Approve and close enabled on a resolved row only; the old "Close" label is gone. */
export async function anAdminApprovesAResolvedRowOnly(): Promise<void> {
  const open: WorkOrderListItem = { ...ROW, id: "0f4e1d2c-0000-4000-8000-000000000003", title: "Still being worked on", status: "in_progress" };
  await renderPage([RESOLVED_ROW, open]);
  expect(approveButton(RESOLVED_ROW.title).disabled).toBe(false);
  expect(approveButton(open.title).disabled).toBe(true);
  expect(approveButton(open.title).title).toBe(APPROVE_NEEDS_RESOLVED);
  expect(screen.queryByRole("button", { name: "Close" }), "the action is named for what it does").toBeNull();
}

/** An operator sees no enabled Approve and close, on a resolved row included, and still has Edit. */
export async function anOperatorSeesNoEnabledApprove(): Promise<void> {
  await renderPage([RESOLVED_ROW], OPERATOR);
  const button = approveButton(RESOLVED_ROW.title);
  expect(button.disabled).toBe(true);
  expect(button.title).toBe(APPROVE_NEEDS_ADMIN);
  await userEvent.click(button);
  expect(screen.queryByRole("dialog"), "a disabled button opens nothing").toBeNull();
  expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(false);
}

function dropOn(card: HTMLElement, column: HTMLElement): void {
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(column, { dataTransfer });
  fireEvent.drop(column, { dataTransfer });
}

function cardOf(title: string): HTMLElement {
  const card = screen.getByText(title).closest("article");
  if (!card) {
    throw new Error(`no card for ${title}`);
  }
  return card as HTMLElement;
}

/**
 * With one cancelled row in the list, a drag still sends a reorder body with no
 * `cancelled` item: the route would refuse the whole batch for one (400).
 */
export async function aDragWithACancelledRowSendsNoCancelledItem(): Promise<void> {
  const reorder = vi.spyOn(workOrdersApi, "reorderWorkOrders").mockResolvedValue({ items: [] });
  await renderPage([ROW, CANCELLED_ROW]);

  // The first empty column is Assigned: the Open column holds the one board row.
  dropOn(cardOf(ROW.title), screen.getAllByText("Drop work orders here")[0] as HTMLElement);

  await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
  const sent = reorder.mock.calls[0]?.[0] ?? [];
  expect(sent).toEqual([{ id: ROW.id, status: "assigned", sortOrder: 0 }]);
  expect(sent.map((item) => item.id)).not.toContain(CANCELLED_ROW.id);
  expect(screen.queryByRole("alert"), "no error alert").toBeNull();
}

/** A cancelled row is on no column; the Cancelled filter lists it, in place of the board. */
export async function aCancelledRowIsOnNoColumnAndUnderItsFilter(): Promise<void> {
  await renderPage([ROW, CANCELLED_ROW]);
  expect(screen.queryByText(CANCELLED_ROW.title), "not on the board").toBeNull();
  expect(screen.getAllByText("Drop work orders here"), "four of the five columns are empty").toHaveLength(4);

  const filter = screen.getByLabelText("Status") as HTMLSelectElement;
  expect(Array.from(filter.options).map((option) => option.text)).toEqual([
    "All statuses",
    "Open",
    "Assigned",
    "In progress",
    "Resolved",
    "Closed",
    "Cancelled",
  ]);
  await userEvent.selectOptions(filter, "cancelled");
  const list = screen.getByRole("region", { name: "Cancelled work orders" });
  expect(within(list).getByText(CANCELLED_ROW.title)).toBeTruthy();
  expect(within(list).getByText("GEN-000002")).toBeTruthy();
  expect(within(list).getByText("Cancelled")).toBeTruthy();
  expect(within(list).queryByRole("button"), "a cancelled ticket has no action").toBeNull();
  expect(screen.queryByText(ROW.title), "the board is replaced by the list").toBeNull();
}

/**
 * A drop on Done is the approval: for an approver on a resolved card it opens the
 * approval wizard; on a card that is not resolved it says why and opens nothing; for
 * an operator it says why and opens nothing. No reorder is sent in any of the three.
 */
export async function aDropOnDoneIsTheApproval(): Promise<void> {
  const reorder = vi.spyOn(workOrdersApi, "reorderWorkOrders");
  const done = (): HTMLElement => screen.getAllByText("Drop work orders here").at(-1) as HTMLElement;

  await renderPage(ROW);
  dropOn(cardOf(ROW.title), done());
  expect((await screen.findByRole("alert")).textContent).toBe(APPROVE_NEEDS_RESOLVED);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(reorder).not.toHaveBeenCalled();
}

/** The same drop by an approver on a resolved card opens the approval wizard. */
export async function aDropOnDoneByAnApproverOpensTheApproval(): Promise<void> {
  const reorder = vi.spyOn(workOrdersApi, "reorderWorkOrders");
  await renderPage(RESOLVED_ROW);
  dropOn(cardOf(RESOLVED_ROW.title), screen.getAllByText("Drop work orders here").at(-1) as HTMLElement);
  expect(await screen.findByRole("dialog", { name: "Approve and close work order" })).toBeTruthy();
  expect(reorder).not.toHaveBeenCalled();
}

/** The same drop by an operator says an administrator is needed, and opens nothing. */
export async function aDropOnDoneByAnOperatorIsRefused(): Promise<void> {
  const reorder = vi.spyOn(workOrdersApi, "reorderWorkOrders");
  await renderPage(RESOLVED_ROW, OPERATOR);
  dropOn(cardOf(RESOLVED_ROW.title), screen.getAllByText("Drop work orders here").at(-1) as HTMLElement);
  expect((await screen.findByRole("alert")).textContent).toBe(APPROVE_NEEDS_ADMIN);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(reorder).not.toHaveBeenCalled();
}
