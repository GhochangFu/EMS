import { expect } from "vitest";

import { BREAKER_PILL, breakerLook } from "./mimic-breaker";

/**
 * `F3.80` / ADR 0101 d10, d11 — the pill text and the look of the two flow tones. `flowing` takes
 * the `closed` look and `shut` the `open` look by mapping; `BreakerLook` gains no key.
 *
 * Assertions live here; `mimic-breaker.test.ts` is the vitest entry point (ADR 0014). One claim
 * per exported function.
 */

/** A flowing valve or damper reads OPEN — the plant word for a passing valve. */
export function flowingPillIsOpen(): void {
  expect(BREAKER_PILL.flowing).toBe("OPEN");
}

/** A shut valve or damper reads SHUT. */
export function shutPillIsShut(): void {
  expect(BREAKER_PILL.shut).toBe("SHUT");
}

/** The breaker pills are byte-identical to `F3.74`'s. */
export function theBreakerPillsAreUnchanged(): void {
  expect({
    closed: BREAKER_PILL.closed,
    open: BREAKER_PILL.open,
    tripped: BREAKER_PILL.tripped,
    offline: BREAKER_PILL.offline,
    unknown: BREAKER_PILL.unknown,
  }).toEqual({ closed: "CLOSED", open: "OPEN", tripped: "TRIPPED", offline: "OFFLINE", unknown: "—" });
}

/** `shut` outranks the alarm tone, as `open` does, and draws the `open` look. */
export function shutWithACriticalAlarmLooksOpen(): void {
  expect(breakerLook("shut", "critical")).toBe("open");
}

/** `flowing` yields to the alarm tone, as `closed` does. */
export function flowingWithAWarningLooksWarning(): void {
  expect(breakerLook("flowing", "warning")).toBe("warning");
}

/** `flowing` with no alarm draws the `closed` look (there is no `flowing` look). */
export function flowingWithNoAlarmLooksClosed(): void {
  expect(breakerLook("flowing", null)).toBe("closed");
}
