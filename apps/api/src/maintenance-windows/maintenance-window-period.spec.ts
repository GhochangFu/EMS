import { expect } from "vitest";

import { MAINTENANCE_WINDOW_MAX_MS } from "@bms/shared";

import { validateExtension, validateWindowPeriod } from "./maintenance-window-period";

/**
 * `F4.359` U3 (ADR 0131 decisions 1 and 2, plan D3) — the 7-day rule is the
 * service's, a pure function, not a table CHECK. Assertions live here; the
 * sibling `.test.ts` runs them (ADR 0014).
 */

const NOW = new Date("2026-11-13T10:00:00.000Z");
const at = (ms: number): Date => new Date(NOW.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Exactly 7 days passes; 7 days and 1 ms fails. */
export function sevenDaysIsTheBound(): void {
  expect(validateWindowPeriod({ now: NOW, startsAt: NOW, endsAt: at(MAINTENANCE_WINDOW_MAX_MS) })).toBeNull();
  expect(validateWindowPeriod({ now: NOW, startsAt: NOW, endsAt: at(MAINTENANCE_WINDOW_MAX_MS + 1) })).toMatch(/7 days/);
  // The bound is the window's length, not its distance from now: a window that starts in a day may run 7 days.
  expect(validateWindowPeriod({ now: NOW, startsAt: at(DAY), endsAt: at(DAY + MAINTENANCE_WINDOW_MAX_MS) })).toBeNull();
}

/** A start 60 s in the past is tolerated (clock skew); 61 s is not. */
export function aStartMoreThanAMinuteAgoFails(): void {
  expect(validateWindowPeriod({ now: NOW, startsAt: at(-60_000), endsAt: at(HOUR) })).toBeNull();
  expect(validateWindowPeriod({ now: NOW, startsAt: at(-61_000), endsAt: at(HOUR) })).toMatch(/past/);
}

/** The end must follow the start and now. */
export function theEndFollowsTheStartAndNow(): void {
  expect(validateWindowPeriod({ now: NOW, startsAt: at(2 * HOUR), endsAt: at(2 * HOUR) })).toMatch(/after its start/);
  expect(validateWindowPeriod({ now: NOW, startsAt: at(-30_000), endsAt: at(-10_000) })).toMatch(/future/);
}

/** An extension to now + 7 d passes on a window already 6 days long (decision 2). */
export function anExtensionMayCarryTheTotalPastSevenDays(): void {
  const currentEndsAt = at(HOUR);
  expect(validateExtension({ now: NOW, endsAt: at(MAINTENANCE_WINDOW_MAX_MS), currentEndsAt })).toBeNull();
  expect(validateExtension({ now: NOW, endsAt: at(MAINTENANCE_WINDOW_MAX_MS + 1), currentEndsAt })).toMatch(/7 days/);
}

/** An extension earlier than, or equal to, the current end fails. */
export function anExtensionMustBeLater(): void {
  const currentEndsAt = at(DAY);
  expect(validateExtension({ now: NOW, endsAt: at(DAY - 1), currentEndsAt })).toMatch(/later than/);
  expect(validateExtension({ now: NOW, endsAt: currentEndsAt, currentEndsAt })).toMatch(/later than/);
  expect(validateExtension({ now: NOW, endsAt: at(DAY + 1), currentEndsAt })).toBeNull();
}
