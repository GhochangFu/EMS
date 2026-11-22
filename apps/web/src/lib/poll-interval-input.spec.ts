import { expect } from "vitest";

import {
  inheritedPollIntervalText,
  isSlowPollInterval,
  parsePollIntervalSeconds,
  POLL_INTERVAL_RANGE_MESSAGE,
  pollIntervalSecondsText,
} from "./poll-interval-input";

/**
 * `F1.2` (plan P4, T7.4) — the seconds field both interval forms use. Pure. The sibling `.test.ts`
 * carries the `it()`s.
 */

/** S1 — empty is null; seconds become milliseconds; the shared 1 s to 1 h bound holds. */
export function runSecondsParseToTheSharedBound(): void {
  expect(parsePollIntervalSeconds("")).toEqual({ ok: true, ms: null });
  expect(parsePollIntervalSeconds("  ")).toEqual({ ok: true, ms: null });
  expect(parsePollIntervalSeconds("30")).toEqual({ ok: true, ms: 30_000 });
  expect(parsePollIntervalSeconds("1.5")).toEqual({ ok: true, ms: 1_500 });
  expect(parsePollIntervalSeconds("1")).toEqual({ ok: true, ms: 1_000 });
  expect(parsePollIntervalSeconds("3600")).toEqual({ ok: true, ms: 3_600_000 });
  for (const bad of ["0.999", "0", "3600.5", "-5", "abc", "1e3", "10s"]) {
    expect(parsePollIntervalSeconds(bad), bad).toEqual({ ok: false });
  }
  expect(POLL_INTERVAL_RANGE_MESSAGE).toBe("Enter seconds from 1 to 3600, or leave it empty to inherit.");
}

/** S2 — P4: the warning starts above 360 s, not at it, and never for an empty or bad field. */
export function runTheWarningStartsAbove360Seconds(): void {
  expect(isSlowPollInterval("360")).toBe(false);
  expect(isSlowPollInterval("361")).toBe(true);
  expect(isSlowPollInterval("3600")).toBe(true);
  expect(isSlowPollInterval("")).toBe(false);
  expect(isSlowPollInterval("9999")).toBe(false);
}

/** S3 — a stored value reads back as seconds; an inherited one names its source. */
export function runStoredValuesReadAsSeconds(): void {
  expect(pollIntervalSecondsText(null)).toBe("");
  expect(pollIntervalSecondsText(45_000)).toBe("45");
  expect(pollIntervalSecondsText(1_500)).toBe("1.5");
  expect(inheritedPollIntervalText(60_000, "the adapter default")).toBe("60 s");
  expect(inheritedPollIntervalText(null, "the adapter default")).toBe("the adapter default");
}
