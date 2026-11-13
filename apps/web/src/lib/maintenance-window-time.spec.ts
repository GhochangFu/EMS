import { expect } from "vitest";

import { isoOfLocalInput, localInputOf, localMinuteOf, localZoneLabel } from "./maintenance-window-time";

/**
 * `F4.359` U15 (review fix) — a maintenance window's times in the browser's own zone: the
 * `datetime-local` value, its ISO instant, the minute shown in a table, and the zone label beside
 * them. `maintenance-window-time.test.ts` is the Vitest entry point and pins `TZ` per case.
 */

/** Any zone: a local value is the instant of its own wall-clock components, built without parsing. */
export function aLocalInputIsTheInstantOfItsComponents(): void {
  expect(isoOfLocalInput("2026-03-01T10:00")).toBe(new Date(2026, 2, 1, 10, 0).toISOString());
  expect(isoOfLocalInput("2026-11-13T23:59")).toBe(new Date(2026, 10, 13, 23, 59).toISOString());
  expect(localInputOf(new Date(2026, 2, 1, 10, 0))).toBe("2026-03-01T10:00");
  expect(isoOfLocalInput("")).toBeUndefined();
  expect(isoOfLocalInput("not a time")).toBeUndefined();
  // An instant with its own zone is not a `datetime-local` value.
  expect(isoOfLocalInput("2026-03-01T10:00:00.000Z")).toBeUndefined();
}

/** `TZ=Asia/Kolkata`: 15:00 typed is 09:30Z, and 09:30Z is shown as 15:00 beside "UTC+05:30". */
export function aKolkataOperatorReadsAndTypesLocalTime(): void {
  expect(isoOfLocalInput("2026-11-13T15:00")).toBe("2026-11-13T09:30:00.000Z");
  expect(localInputOf(new Date("2026-11-13T09:30:00.000Z"))).toBe("2026-11-13T15:00");
  expect(localMinuteOf("2026-11-13T09:30:00.000Z")).toBe("2026-11-13 15:00");
  expect(localZoneLabel(new Date("2026-11-13T09:30:00.000Z"))).toBe("UTC+05:30");
}

/** `TZ=America/St_Johns`: a negative half-hour zone, with its summer offset. */
export function aStJohnsOperatorReadsAndTypesLocalTime(): void {
  expect(isoOfLocalInput("2026-01-10T08:00")).toBe("2026-01-10T11:30:00.000Z");
  expect(localMinuteOf("2026-01-10T11:30:00.000Z")).toBe("2026-01-10 08:00");
  expect(localZoneLabel(new Date("2026-01-10T11:30:00.000Z"))).toBe("UTC-03:30");
  expect(localZoneLabel(new Date("2026-07-10T11:30:00.000Z"))).toBe("UTC-02:30");
}

/** `TZ=UTC`: the label is plain "UTC". */
export function aUtcOperatorSeesUtc(): void {
  expect(localZoneLabel(new Date("2026-11-13T09:30:00.000Z"))).toBe("UTC");
  expect(localMinuteOf("2026-11-13T09:30:00.000Z")).toBe("2026-11-13 09:30");
}
