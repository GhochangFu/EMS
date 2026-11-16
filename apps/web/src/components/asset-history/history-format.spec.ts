import { expect } from "vitest";

import { axisLabelInZone, formatReading, timeAxisLabel } from "./history-format";

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

/**
 * A reading keeps every digit the sensor sent and loses only a float's binary tail: the AWS
 * demo showed `1.2000000000000002 degC` (E1.4 demo checks). It is not rounded to a display
 * precision, because this is where an operator reads the raw value: 49.96 Hz is not 50 Hz.
 */
export function aReadingLosesOnlyItsBinaryTail(): void {
  expect(formatReading(1.2000000000000002, "degC")).toBe("1.2 degC");
  expect(formatReading(0.1 + 0.2, null)).toBe("0.3");
  expect(formatReading(49.96, "Hz")).toBe("49.96 Hz");
  expect(formatReading(0.987, null)).toBe("0.987");
  expect(formatReading(123456.78, "kWh")).toBe("123456.78 kWh");
  expect(formatReading(-27.6, "degC")).toBe("-27.6 degC");
  expect(formatReading(42, "kW")).toBe("42 kW");
}

/** No reading, or one that is not a finite number, is the dash. */
export function noReadingIsTheDash(): void {
  expect(formatReading(null, "degC")).toBe("—");
  expect(formatReading(undefined, "degC")).toBe("—");
  expect(formatReading(Number.NaN, "degC")).toBe("—");
  expect(formatReading(Number.POSITIVE_INFINITY, null)).toBe("—");
}

