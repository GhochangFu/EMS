import type { WorkOrderEventDto } from "@bms/shared";
import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import { WorkOrderTimeline } from "./work-order-timeline";

function ev(over: Partial<WorkOrderEventDto>): WorkOrderEventDto {
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

export function eachRowShowsTheStoredActorName(): void {
  render(
    <WorkOrderTimeline
      events={[
        ev({ id: "1", actorName: "Asha" }),
        ev({ id: "2", eventType: "assigned", actorName: "Ravi" }),
        ev({ id: "3", eventType: "resolved", actorName: null }),
      ]}
    />,
  );
  const items = within(screen.getByRole("list", { name: "Work order timeline" })).getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items[0]?.textContent).toContain("Asha");
  expect(items[1]?.textContent).toContain("Ravi");
  expect(items[2]?.textContent).toContain("System");
  expect(items[1]?.textContent).toContain("Assigned");
}

export function aStatusChangeNamesBothStatuses(): void {
  render(<WorkOrderTimeline events={[ev({ eventType: "status_changed", fromStatus: "open", toStatus: "in_progress" })]} />);
  expect(screen.getByText("Status changed · Open → In progress")).toBeTruthy();
}

export function onlyASelfApprovedApprovalSaysSo(): void {
  const { unmount } = render(
    <WorkOrderTimeline events={[ev({ eventType: "approved", detail: { selfApproved: true } })]} />,
  );
  expect(screen.getByText("Approved")).toBeTruthy();
  expect(screen.getByText("Self-approved")).toBeTruthy();
  unmount();
  render(<WorkOrderTimeline events={[ev({ eventType: "approved", detail: {} })]} />);
  expect(screen.getByText("Approved")).toBeTruthy();
  expect(screen.queryByText("Self-approved")).toBeNull();
}

export function theReasonIsShown(): void {
  render(<WorkOrderTimeline events={[ev({ eventType: "rejected", detail: { reason: "Photo missing" } })]} />);
  expect(screen.getByText("Rejected")).toBeTruthy();
  expect(screen.getByText("Photo missing")).toBeTruthy();
}

export function anEmptyListSaysSo(): void {
  render(<WorkOrderTimeline events={[]} />);
  expect(screen.getByText("No history recorded for this work order.")).toBeTruthy();
}
