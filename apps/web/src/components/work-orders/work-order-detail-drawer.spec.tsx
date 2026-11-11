import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { UserRole, WorkOrderDetail } from "@bms/shared";

import * as workOrdersApi from "../../api/work-orders";
import { WorkOrderDetailDrawer } from "./work-order-detail-drawer";

/**
 * `E3.1` (ADR 0122 decision 8; plan PR 6) — the detail drawer: what it shows for one
 * ticket, and which of its parts a role and a status leave in. Each part's own
 * behaviour is its own spec; this one holds the drawer's wiring. Assertions live here;
 * `work-order-detail-drawer.test.tsx` is the Vitest entry point (ADR 0014).
 */

const ID = "0f4e1d2c-0000-4000-8000-000000000042";

const DETAIL: WorkOrderDetail = {
  id: ID,
  assetId: "0f4e1d2c-0000-4000-8000-0000000000a1",
  alarmId: "0f4e1d2c-0000-4000-8000-0000000000b1",
  title: "Aeration blower tripped",
  description: "Blower 2 tripped on overload",
  status: "in_progress",
  priority: "high",
  sortOrder: 0,
  assignedTo: null,
  createdBy: null,
  dueAt: null,
  resolvedAt: null,
  closedAt: null,
  reference: "STP-000042",
  slaMinutes: 60,
  slaDueAt: "2026-11-10T11:00:00.000Z",
  slaState: "on_track",
  checklistDone: 0,
  checklistTotal: 1,
  causeCode: null,
  approvedAt: null,
  createdAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:05:00.000Z",
  assetCode: "BLW-02",
  assetRtuName: "STP RTU",
  assetLocationName: "STP",
  assetName: "Aeration blower 2",
  siteName: "Plant A",
  events: [
    {
      id: "e1",
      eventType: "created",
      actorName: "Asha Rao",
      fromStatus: null,
      toStatus: "open",
      detail: { origin: "alarm" },
      createdAt: "2026-11-10T10:00:00.000Z",
    },
  ],
  alarm: { id: "0f4e1d2c-0000-4000-8000-0000000000b1", severity: "critical", message: "Blower overload", raisedAt: "2026-11-10T09:58:00.000Z" },
  tasks: [
    {
      id: "t1",
      title: "Isolate the blower",
      mandatory: true,
      result: "pending",
      note: null,
      sortOrder: 0,
      completedAt: null,
      completedBy: null,
      templateItemId: null,
    },
  ],
  rootCause: null,
  correctiveAction: null,
  preventiveAction: null,
  resolvedBy: null,
  approvedBy: null,
  cancelledBy: null,
  cancelledAt: null,
  alarmSnapshot: { rootCause: "Bearing seized", correctiveActions: "Replace the bearing", skillCode: "mechanical", etrAt: null },
};

async function renderDrawer(role: UserRole, detail: Partial<WorkOrderDetail> = {}, onClose: () => void = () => undefined): Promise<HTMLElement> {
  vi.spyOn(workOrdersApi, "fetchWorkOrderDetail").mockResolvedValue({ ...DETAIL, ...detail });
  vi.spyOn(workOrdersApi, "fetchWorkOrderCauseCodes").mockResolvedValue({
    items: [{ code: "wear_and_tear", label: "Wear and tear", sortOrder: 20 }],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkOrderDetailDrawer workOrderId={ID} role={role} onClose={onClose} />
    </QueryClientProvider>,
  );
  const dialog = await screen.findByRole("dialog", { name: DETAIL.title });
  await within(dialog).findByText("WO #STP-000042");
  return dialog;
}

/** The drawer reads the ticket by id and shows its reference as `WO #STP-000042`, its SLA, its five steps and every part. */
export async function theDrawerShowsTheTicket(): Promise<void> {
  const dialog = await renderDrawer("admin");
  expect(workOrdersApi.fetchWorkOrderDetail).toHaveBeenCalledWith(ID);
  expect(within(dialog).getByText("WO #STP-000042")).toBeTruthy();
  expect(within(dialog).getByText(/^SLA 1h/)).toBeTruthy();
  expect(within(within(dialog).getByRole("list", { name: "Work order progress" })).getAllByRole("listitem")).toHaveLength(5);
  expect(within(dialog).getByRole("region", { name: "Checklist" })).toBeTruthy();
  expect(within(dialog).getByRole("form", { name: "Root cause" })).toBeTruthy();
  expect(within(within(dialog).getByRole("region", { name: "From the alarm" })).getByText("Bearing seized")).toBeTruthy();
  expect(within(dialog).getByRole("list", { name: "Work order timeline" }).textContent).toContain("Asha Rao");
  expect(within(dialog).getByText("Raised from alarm: Blower overload (critical)")).toBeTruthy();
}

/** A ticket with no snapshot shows no "From the alarm" block. */
export async function aTicketWithNoSnapshotShowsNoAlarmBlock(): Promise<void> {
  const dialog = await renderDrawer("admin", { alarmSnapshot: null });
  expect(within(dialog).queryByRole("region", { name: "From the alarm" })).toBeNull();
}

/** An approver sees cancel on a live ticket and no reject; on a resolved one, both. */
export async function anApproverSeesRejectAndCancelWhereTheyApply(): Promise<void> {
  const live = await renderDrawer("location_admin");
  expect(within(live).getByRole("form", { name: "Cancel work order" })).toBeTruthy();
  expect(within(live).queryByRole("form", { name: "Reject work order" })).toBeNull();
}

/** The same, on a resolved ticket: reject and cancel are both offered. */
export async function aResolvedTicketOffersRejectAndCancelToAnApprover(): Promise<void> {
  const resolved = await renderDrawer("organization_admin", { status: "resolved", resolvedAt: "2026-11-10T10:30:00.000Z" });
  expect(within(resolved).getByRole("form", { name: "Reject work order" })).toBeTruthy();
  expect(within(resolved).getByRole("form", { name: "Cancel work order" })).toBeTruthy();
}

/** An operator sees neither reject nor cancel, on a resolved ticket included, and may still write the checklist's lock rule aside. */
export async function anOperatorSeesNoRejectAndNoCancel(): Promise<void> {
  const dialog = await renderDrawer("operator", { status: "resolved", resolvedAt: "2026-11-10T10:30:00.000Z" });
  expect(within(dialog).queryByRole("form", { name: "Reject work order" })).toBeNull();
  expect(within(dialog).queryByRole("form", { name: "Cancel work order" })).toBeNull();
  // Resolved: the checklist is locked for everyone, the root cause is still open to an operator.
  expect((within(dialog).getByRole("checkbox", { name: "Isolate the blower" }) as HTMLInputElement).disabled).toBe(true);
  expect((within(dialog).getByLabelText("Cause found") as HTMLTextAreaElement).disabled).toBe(false);
}

/** An operator on a live ticket may tick the checklist and type the root cause. */
export async function anOperatorWritesTheChecklistAndTheRootCauseOnALiveTicket(): Promise<void> {
  const dialog = await renderDrawer("operator");
  expect((within(dialog).getByRole("checkbox", { name: "Isolate the blower" }) as HTMLInputElement).disabled).toBe(false);
  expect((within(dialog).getByLabelText("Cause found") as HTMLTextAreaElement).disabled).toBe(false);
}

/** A viewer reads everything and writes nothing: the checklist and the root cause are locked, and there is no reject or cancel. */
export async function aViewerReadsAndWritesNothing(): Promise<void> {
  const dialog = await renderDrawer("viewer");
  expect((within(dialog).getByRole("checkbox", { name: "Isolate the blower" }) as HTMLInputElement).disabled).toBe(true);
  expect((within(dialog).getByLabelText("Cause found") as HTMLTextAreaElement).disabled).toBe(true);
  expect(within(dialog).queryByRole("button", { name: "Save root cause" })).toBeNull();
  expect(within(dialog).queryByRole("form", { name: "Cancel work order" })).toBeNull();
}

/** A closed ticket locks the root cause and the checklist and offers no reject and no cancel; a cancelled one the same. */
export async function aTerminalTicketIsLocked(): Promise<void> {
  const terminal: Array<Partial<WorkOrderDetail>> = [
    { status: "closed", closedAt: "2026-11-10T11:00:00.000Z", approvedAt: "2026-11-10T11:00:00.000Z" },
    { status: "cancelled", cancelledAt: "2026-11-10T11:00:00.000Z", slaState: "none" },
  ];
  for (const detail of terminal) {
    const dialog = await renderDrawer("admin", detail);
    expect((within(dialog).getByRole("checkbox", { name: "Isolate the blower" }) as HTMLInputElement).disabled, detail.status).toBe(true);
    expect((within(dialog).getByLabelText("Cause found") as HTMLTextAreaElement).disabled, detail.status).toBe(true);
    expect(within(dialog).queryByRole("form", { name: "Cancel work order" }), detail.status).toBeNull();
    expect(within(dialog).queryByRole("form", { name: "Reject work order" }), detail.status).toBeNull();
    cleanup();
  }
}

/** A cancelled ticket keeps its SLA minutes and is owed none: the drawer reads `No SLA`, never `SLA 1h`. */
export async function aCancelledTicketReadsNoSla(): Promise<void> {
  const dialog = await renderDrawer("admin", { status: "cancelled", cancelledAt: "2026-11-10T11:00:00.000Z", slaState: "none" });
  expect(within(dialog).getByText("No SLA")).toBeTruthy();
  expect(within(dialog).queryByText(/SLA 1h/)).toBeNull();
}

/**
 * A finding being typed survives another write in the drawer: ticking a checklist item
 * re-reads the ticket with a new `updatedAt`, and the root-cause form must not start over.
 */
export async function typedFindingsSurviveAChecklistTick(): Promise<void> {
  const dialog = await renderDrawer("operator");
  await userEvent.type(within(dialog).getByLabelText("Cause found"), "Bearing seized");
  const read = vi.mocked(workOrdersApi.fetchWorkOrderDetail);
  const before = read.mock.calls.length;
  read.mockResolvedValue({
    ...DETAIL,
    updatedAt: "2026-11-10T10:09:00.000Z",
    checklistDone: 1,
    tasks: [{ ...DETAIL.tasks[0]!, result: "done" }],
  });
  vi.spyOn(workOrdersApi, "updateWorkOrderTask").mockResolvedValue({ ...DETAIL.tasks[0]!, result: "done" });
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Isolate the blower" }));
  await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
  await vi.waitFor(() => expect((within(dialog).getByRole("checkbox", { name: "Isolate the blower" }) as HTMLInputElement).checked).toBe(true));
  expect((within(dialog).getByLabelText("Cause found") as HTMLTextAreaElement).value).toBe("Bearing seized");
}

/**
 * A reject inside the drawer re-reads the ticket: the drawer then shows it In progress,
 * and the reject form is gone.
 */
export async function aRejectRefreshesTheDrawer(): Promise<void> {
  const resolved: Partial<WorkOrderDetail> = { status: "resolved", resolvedAt: "2026-11-10T10:30:00.000Z" };
  const dialog = await renderDrawer("admin", resolved);
  expect(within(dialog).getByText("Resolved")).toBeTruthy();
  vi.mocked(workOrdersApi.fetchWorkOrderDetail).mockResolvedValue({ ...DETAIL, status: "in_progress", updatedAt: "2026-11-10T10:40:00.000Z" });
  const reject = vi.spyOn(workOrdersApi, "rejectWorkOrder").mockResolvedValue({ ...DETAIL, status: "in_progress" });
  const form = within(dialog).getByRole("form", { name: "Reject work order" });
  await userEvent.type(within(form).getByLabelText("Reason for rejecting"), "The seal still leaks");
  await userEvent.click(within(form).getByRole("button", { name: "Reject and send back" }));
  await vi.waitFor(() => expect(within(dialog).queryByRole("form", { name: "Reject work order" })).toBeNull());
  expect(reject).toHaveBeenCalledWith(ID, "The seal still leaks");
  expect(within(dialog).getByText("In progress")).toBeTruthy();
}

/** A write inside the drawer reads the ticket again, so what it shows is what the server holds. */
export async function aWriteInsideTheDrawerReadsTheTicketAgain(): Promise<void> {
  const dialog = await renderDrawer("admin");
  const read = vi.mocked(workOrdersApi.fetchWorkOrderDetail);
  const before = read.mock.calls.length;
  vi.spyOn(workOrdersApi, "updateWorkOrderTask").mockResolvedValue({ ...DETAIL.tasks[0]!, result: "done" });
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Isolate the blower" }));
  await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
  expect(workOrdersApi.updateWorkOrderTask).toHaveBeenCalledWith(ID, "t1", { result: "done" });
}

/** The close control calls the page back. */
export async function closeDetailsCallsThePageBack(): Promise<void> {
  const onClose = vi.fn();
  const dialog = await renderDrawer("admin", {}, onClose);
  await userEvent.click(within(dialog).getByRole("button", { name: "Close details" }));
  expect(onClose).toHaveBeenCalledTimes(1);
}

/** A ticket that cannot be read — out of scope, or gone — shows one sentence and none of the parts. */
export async function aTicketThatCannotBeReadShowsASentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "fetchWorkOrderDetail").mockRejectedValue(new Error("work-order 404"));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkOrderDetailDrawer workOrderId={ID} role="admin" onClose={() => undefined} />
    </QueryClientProvider>,
  );
  expect((await screen.findByRole("alert")).textContent).toContain("Could not load this work order");
  expect(screen.queryByRole("region", { name: "Checklist" })).toBeNull();
}
