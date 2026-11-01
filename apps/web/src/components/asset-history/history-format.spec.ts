import { expect } from "vitest";

import { axisLabelInZone, timeAxisLabel } from "./history-format";

/** 2026-10-31T18:30:00Z is 00:00 on 1 Nov in Asia/Kolkata and 15:00 on 31 Oct in St John's. */
const KOLKATA_MIDNIGHT = Date.parse("2026-10-31T18:30:00Z");

export function theAxisLabelIsTimeOverDateInTheSiteZone(): void {
  expect(axisLabelInZone(KOLKATA_MIDNIGHT, "Asia/Kolkata")).toBe("00:00\n1 Nov");
  expect(axisLabelInZone(KOLKATA_MIDNIGHT, "UTC")).toBe("18:30\n31 Oct");
}

export function theTimeAxisHidesOverlapsAndTheForcedEndLabels(): void {
  const label = timeAxisLabel("Asia/Kolkata");
  expect(label.hideOverlap).toBe(true);
  expect(label.showMinLabel).toBe(false);
  expect(label.showMaxLabel).toBe(false);
  expect(label.formatter(KOLKATA_MIDNIGHT)).toBe("00:00\n1 Nov");
}
