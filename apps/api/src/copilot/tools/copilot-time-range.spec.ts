import { expect } from "vitest";
import { z } from "zod";

import {
  COPILOT_RANGE_BOTH,
  COPILOT_RANGE_NEEDED,
  COPILOT_RANGE_ORDER,
  COPILOT_RANGE_OUT_OF_CLOCK,
  copilotRangeTooLong,
  refineInstantRange,
  resolveInstantRange,
  timeRangeFields,
} from "./copilot-time-range";

/**
 * `F4.291` PR 2 (ADR 0099 Amendment 9 E5; owner ruling P3) — the range
 * arguments of the copilot's range tools: `from`/`to` (ISO instants with an
 * offset) or `lastDays` (1–31), never both; `to` after `from`; at most
 * `maxDays` when the tool bounds it; `lastDays` resolved against the turn's
 * clock (`ctx.now`), so the model never has to know the date. Vitest entry
 * point: the sibling `.test.ts` (ADR 0014).
 */

const NOW = new Date("2026-10-28T06:00:00.000Z");
const DAY = 86_400_000;

const bounded = z.object(timeRangeFields).strict().superRefine((args, issue) => refineInstantRange(args, issue, { maxDays: 31, required: true }));
const open = z.object(timeRangeFields).strict().superRefine((args, issue) => refineInstantRange(args, issue, {}));

const messages = (result: z.SafeParseReturnType<unknown, unknown>): string[] =>
  result.success ? [] : result.error.issues.map((issue) => issue.message);

const iso = (ms: number) => new Date(ms).toISOString();

export function assertToBeforeFromIsRefused(): void {
  expect(open.safeParse({ from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" }).success).toBe(true);
  expect(messages(open.safeParse({ from: "2026-10-02T00:00:00Z", to: "2026-10-01T00:00:00Z" }))).toEqual([COPILOT_RANGE_ORDER]);
}

export function assertExactlyThirtyOneDaysIsAccepted(): void {
  const from = Date.parse("2026-09-01T00:00:00Z");
  expect(bounded.safeParse({ from: iso(from), to: iso(from + 31 * DAY) }).success).toBe(true);
}

export function assertThirtyOneDaysAndASecondIsRefused(): void {
  const from = Date.parse("2026-09-01T00:00:00Z");
  expect(messages(bounded.safeParse({ from: iso(from), to: iso(from + 31 * DAY + 1000) }))).toEqual([copilotRangeTooLong(31)]);
}

export function assertNoMaxDaysIsNoBound(): void {
  const from = Date.parse("2025-01-01T00:00:00Z");
  expect(open.safeParse({ from: iso(from), to: iso(from + 400 * DAY) }).success).toBe(true);
}

export function assertLastDaysWithFromOrToIsRefused(): void {
  expect(bounded.safeParse({ lastDays: 7 }).success).toBe(true);
  expect(messages(bounded.safeParse({ lastDays: 7, from: "2026-10-01T00:00:00Z" }))).toEqual([COPILOT_RANGE_BOTH]);
  expect(messages(open.safeParse({ lastDays: 7, to: "2026-10-01T00:00:00Z" }))).toEqual([COPILOT_RANGE_BOTH]);
}

export function assertLastDaysIsOneToThirtyOne(): void {
  expect(bounded.safeParse({ lastDays: 31 }).success).toBe(true);
  expect(bounded.safeParse({ lastDays: 32 }).success).toBe(false);
  expect(bounded.safeParse({ lastDays: 0 }).success).toBe(false);
  expect(bounded.safeParse({ lastDays: 1.5 }).success).toBe(false);
}

export function assertARequiredRangeNeedsOne(): void {
  expect(messages(bounded.safeParse({}))).toEqual([COPILOT_RANGE_NEEDED]);
  expect(messages(bounded.safeParse({ from: "2026-10-01T00:00:00Z" }))).toEqual([COPILOT_RANGE_NEEDED]);
  expect(open.safeParse({}).success).toBe(true);
}

export function assertLastDaysResolvesAgainstNow(): void {
  expect(resolveInstantRange({ lastDays: 7 }, NOW)).toEqual({ ok: true, from: new Date(NOW.getTime() - 7 * DAY), to: NOW });
}

export function assertFromAndToResolveAsGiven(): void {
  expect(resolveInstantRange({ from: "2026-10-01T05:30:00+05:30", to: "2026-10-02T00:00:00Z" }, NOW)).toEqual({
    ok: true,
    from: new Date("2026-10-01T00:00:00Z"),
    to: new Date("2026-10-02T00:00:00Z"),
  });
  expect(resolveInstantRange({}, NOW)).toEqual({ ok: true });
}

/** An instant before 1970 or more than a day past the turn's clock is refused (critic: bound against ctx.now). */
export function assertAnInstantOffTheClockIsRefused(): void {
  expect(resolveInstantRange({ from: iso(NOW.getTime() - DAY), to: iso(NOW.getTime() + DAY) }, NOW).ok).toBe(true);
  expect(resolveInstantRange({ from: iso(NOW.getTime() - DAY), to: iso(NOW.getTime() + DAY + 1000) }, NOW)).toEqual({
    ok: false,
    error: COPILOT_RANGE_OUT_OF_CLOCK,
  });
  expect(resolveInstantRange({ from: "1969-12-31T23:59:59Z", to: "1970-01-02T00:00:00Z" }, NOW)).toEqual({
    ok: false,
    error: COPILOT_RANGE_OUT_OF_CLOCK,
  });
}
