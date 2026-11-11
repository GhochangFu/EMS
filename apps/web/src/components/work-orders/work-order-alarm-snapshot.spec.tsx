import type { WorkOrderAlarmSnapshot as Snapshot } from "@bms/shared";
import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { WorkOrderAlarmSnapshot } from "./work-order-alarm-snapshot";

const SNAPSHOT: Snapshot = {
  rootCause: "Loose busbar",
  correctiveActions: "Re-torque lugs",
  skillCode: "ELEC-L2",
  etrAt: "2026-11-02T12:00:00.000Z",
};

export function theFourValuesAreShown(): void {
  render(<WorkOrderAlarmSnapshot snapshot={SNAPSHOT} />);
  expect(screen.getByRole("region", { name: "From the alarm" })).toBeTruthy();
  expect(screen.getByText("As recorded on the alarm when this work order was created.")).toBeTruthy();
  for (const term of ["Root cause", "Corrective actions", "Skill", "Estimated restore"]) {
    expect(screen.getByText(term)).toBeTruthy();
  }
  expect(screen.getByText("Loose busbar")).toBeTruthy();
  expect(screen.getByText("Re-torque lugs")).toBeTruthy();
  expect(screen.getByText("ELEC-L2")).toBeTruthy();
  expect(screen.getByText(new Date(SNAPSHOT.etrAt as string).toLocaleString())).toBeTruthy();
}

export function aNullValueReadsNotRecorded(): void {
  render(<WorkOrderAlarmSnapshot snapshot={{ ...SNAPSHOT, skillCode: null, etrAt: null }} />);
  expect(screen.getAllByText("Not recorded")).toHaveLength(2);
}

export function noFormControlIsRendered(): void {
  const { container } = render(<WorkOrderAlarmSnapshot snapshot={SNAPSHOT} />);
  expect(container.querySelector("input,textarea,select")).toBeNull();
}

export function aNullSnapshotRendersNothing(): void {
  const { container } = render(<WorkOrderAlarmSnapshot snapshot={null} />);
  expect(container.firstChild).toBeNull();
}
