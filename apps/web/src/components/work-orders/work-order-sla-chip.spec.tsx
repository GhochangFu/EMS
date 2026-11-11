import { WORK_ORDER_SLA_STATES } from "@bms/shared";
import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { SLA_STATE_LABELS, slaChipClass, WorkOrderSlaChip } from "./work-order-sla-chip";

export function theChipRendersTheMinutesInTheReferenceWording(): void {
  const { unmount } = render(<WorkOrderSlaChip slaMinutes={30} slaState="on_track" />);
  expect(screen.getByText("SLA 30 mins · On track")).toBeTruthy();
  unmount();
  const second = render(<WorkOrderSlaChip slaMinutes={60} slaState="at_risk" />);
  expect(screen.getByText("SLA 1h · At risk")).toBeTruthy();
  second.unmount();
  render(<WorkOrderSlaChip slaMinutes={1680} slaState="breached" />);
  expect(screen.getByText("SLA 1d 4h · Breached")).toBeTruthy();
}

export function allSixStatesHaveDistinctClasses(): void {
  const classes = WORK_ORDER_SLA_STATES.map((s) => slaChipClass(s));
  expect(new Set(classes).size).toBe(6);
  expect(SLA_STATE_LABELS.met).toBe("Met");
  expect(SLA_STATE_LABELS.missed).toBe("Missed");
  expect(SLA_STATE_LABELS.none).toBe("No SLA");
}

export function nullMinutesReadsNoSla(): void {
  const { unmount } = render(<WorkOrderSlaChip slaMinutes={null} slaState="none" />);
  expect(screen.getByText("No SLA")).toBeTruthy();
  unmount();
  // A cancelled ticket keeps its minutes and reads `none`: it is owed no SLA, so no "SLA 1h".
  render(<WorkOrderSlaChip slaMinutes={60} slaState="none" />);
  expect(screen.getByText("No SLA")).toBeTruthy();
  expect(screen.queryByText(/1h/)).toBeNull();
}
