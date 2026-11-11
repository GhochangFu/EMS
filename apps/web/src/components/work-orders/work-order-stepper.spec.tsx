import type { WorkOrderDetail, WorkOrderEventDto, WorkOrderStatus } from "@bms/shared";
import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import { WorkOrderStepper, workOrderSteps } from "./work-order-stepper";

/** `E3.1` / ADR 0122 decision 8 — a detail fixture; every field not under test is inert. */
export function detailFixture(over: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: "wo-1",
    reference: "ELEC-1",
    assetId: "a-1",
    alarmId: "al-1",
    title: "t",
    description: null,
    status: "open",
    priority: "high",
    sortOrder: 0,
    assignedTo: null,
    createdBy: null,
    dueAt: null,
    resolvedAt: null,
    closedAt: null,
    slaMinutes: 60,
    slaDueAt: null,
    slaState: "on_track",
    checklistDone: 0,
    checklistTotal: 0,
    causeCode: null,
    approvedAt: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    assetCode: "A",
    assetRtuName: null,
    assetLocationName: null,
    assetName: "Asset",
    siteName: "Site",
    events: [],
    alarm: { id: "al-1", severity: "critical", message: "m", raisedAt: "2026-11-01T09:55:00.000Z" },
    tasks: [],
    rootCause: null,
    correctiveAction: null,
    preventiveAction: null,
    resolvedBy: null,
    approvedBy: null,
    cancelledBy: null,
    cancelledAt: null,
    alarmSnapshot: null,
    ...over,
  };
}

export function eventFixture(over: Partial<WorkOrderEventDto> = {}): WorkOrderEventDto {
  return {
    id: "e-1",
    eventType: "created",
    actorName: "Asha",
    fromStatus: null,
    toStatus: null,
    detail: {},
    createdAt: "2026-11-01T10:00:00.000Z",
    ...over,
  };
}

function states(detail: WorkOrderDetail): string[] {
  return workOrderSteps(detail).map((s) => s.state);
}

function withStatus(status: WorkOrderStatus, over: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return detailFixture({ status, ...over });
}

export function anInProgressAlarmTicketShowsFiveStepsFourReached(): void {
  const { container } = render(<WorkOrderStepper detail={withStatus("in_progress")} />);
  const list = screen.getByRole("list", { name: "Work order progress" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  expect(container.querySelectorAll('li[data-state="reached"]')).toHaveLength(4);
  expect(screen.getByText("Alarm Triggered")).toBeTruthy();
}

export function aResolvedTicketAwaitsApproval(): void {
  const { container } = render(<WorkOrderStepper detail={withStatus("resolved")} />);
  expect(screen.getByText("Awaiting approval")).toBeTruthy();
  const current = container.querySelector('li[aria-current="step"]');
  expect(current?.getAttribute("data-state")).toBe("current");
  expect(current?.textContent).toContain("Awaiting approval");
}

export function aCancelledTicketStopsWhereItWasAndReadsCancelled(): void {
  const detail = withStatus("cancelled", {
    events: [eventFixture({ id: "e-9", eventType: "cancelled", fromStatus: "assigned", toStatus: "cancelled" })],
  });
  expect(states(detail)).toEqual(["reached", "reached", "reached", "pending", "cancelled"]);
  render(<WorkOrderStepper detail={detail} />);
  expect(screen.getByText("Cancelled")).toBeTruthy();
  // A cancelled ticket with no event falls back to two reached steps; a resolved one counts four.
  expect(states(withStatus("cancelled"))).toEqual(["reached", "reached", "pending", "pending", "cancelled"]);
  const fromResolved = withStatus("cancelled", {
    events: [eventFixture({ eventType: "cancelled", fromStatus: "resolved", toStatus: "cancelled" })],
  });
  expect(states(fromResolved)).toEqual(["reached", "reached", "reached", "reached", "cancelled"]);
}

export function theFirstStepNamesHowTheTicketWasRaised(): void {
  const manual = workOrderSteps(withStatus("open", { alarmId: null, alarm: null }));
  expect(manual[0]?.label).toBe("Raised manually");
  const scheduled = workOrderSteps(
    withStatus("open", {
      alarmId: null,
      alarm: null,
      events: [eventFixture({ detail: { origin: "schedule" } })],
    }),
  );
  expect(scheduled[0]?.label).toBe("Scheduled maintenance");
  expect(workOrderSteps(withStatus("open"))[0]?.label).toBe("Alarm Triggered");
}

export function aTicketWithNoEventsStillDrawsFromItsStatus(): void {
  expect(states(withStatus("open"))).toEqual(["reached", "reached", "pending", "pending", "pending"]);
  expect(states(withStatus("assigned"))).toEqual(["reached", "reached", "reached", "pending", "pending"]);
  expect(states(withStatus("in_progress"))).toEqual(["reached", "reached", "reached", "reached", "pending"]);
  expect(workOrderSteps(withStatus("open"))[2]?.at).toBeNull();
}

export function aClosedTicketReadsCompletedWithFiveReached(): void {
  const { container } = render(<WorkOrderStepper detail={withStatus("closed", { closedAt: "2026-11-02T10:00:00.000Z" })} />);
  expect(container.querySelectorAll('li[data-state="reached"]')).toHaveLength(5);
  expect(screen.getByText("Completed")).toBeTruthy();
  expect(workOrderSteps(withStatus("closed", { closedAt: "2026-11-02T10:00:00.000Z" }))[4]?.at).toBe(
    "2026-11-02T10:00:00.000Z",
  );
}
