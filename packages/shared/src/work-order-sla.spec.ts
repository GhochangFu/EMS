import {
  formatSlaMinutes,
  WORK_ORDER_SLA_DEFAULT_MINUTES,
  workOrderSlaState,
} from "./work-order-sla";

/**
 * `E3.1` / ADR 0122 decision 3 — the SLA state and its wording. Assertions live here;
 * `work-order-sla.test.ts` is the vitest entry point (ADR 0014).
 */

function assertEqual(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const CREATED = new Date("2026-11-10T10:00:00.000Z");
const MINUTES = 100;
const DUE = new Date(CREATED.getTime() + MINUTES * 60_000);

function stateAt(nowMs: number, resolvedAt: Date | null = null): string {
  return workOrderSlaState({
    slaMinutes: MINUTES,
    slaDueAt: DUE,
    resolvedAt,
    now: new Date(nowMs),
  });
}

/** Ruling Q6: 30 minutes, 1 hour, 4 hours, 24 hours. */
export function defaultsAreTheRuledFour(): void {
  assertEqual(JSON.stringify(WORK_ORDER_SLA_DEFAULT_MINUTES), JSON.stringify({ critical: 30, high: 60, medium: 240, low: 1440 }), "defaults");
}

/** A ticket with no SLA (older than the columns) reads `none`, whatever the clock says. */
export function noSlaReadsNone(): void {
  assertEqual(
    workOrderSlaState({ slaMinutes: null, slaDueAt: null, resolvedAt: null, now: new Date(DUE.getTime() + 1) }),
    "none",
    "no sla",
  );
  assertEqual(
    workOrderSlaState({ slaMinutes: MINUTES, slaDueAt: null, resolvedAt: null, now: CREATED }),
    "none",
    "minutes without a due time",
  );
}

/** Resolved on the due instant is `met`; one millisecond later is `missed`. */
export function resolvedIsMetOrMissed(): void {
  assertEqual(stateAt(DUE.getTime() + 999_999, DUE), "met", "resolved exactly at due");
  assertEqual(stateAt(CREATED.getTime(), new Date(DUE.getTime() - 1)), "met", "resolved before due");
  assertEqual(stateAt(CREATED.getTime(), new Date(DUE.getTime() + 1)), "missed", "resolved after due");
}

/** Unresolved past the due instant is `breached`; on the instant it is still `at_risk`. */
export function unresolvedPastDueIsBreached(): void {
  assertEqual(stateAt(DUE.getTime() + 1), "breached", "one ms late");
  assertEqual(stateAt(DUE.getTime()), "at_risk", "on the due instant");
}

/** Exactly 20% of the window left is `on_track`; one millisecond less is `at_risk`. */
export function atRiskStartsBelowTwentyPercent(): void {
  const twentyPercentLeft = DUE.getTime() - MINUTES * 60_000 * 0.2;
  assertEqual(stateAt(twentyPercentLeft), "on_track", "exactly 20% left");
  assertEqual(stateAt(twentyPercentLeft + 1), "at_risk", "one ms under 20%");
  assertEqual(stateAt(CREATED.getTime()), "on_track", "at creation");
}

/** The reference layout's wording: `30 mins`, `1h`, `1d 4h`. */
export function formatsLikeTheReference(): void {
  assertEqual(formatSlaMinutes(30), "30 mins", "30");
  assertEqual(formatSlaMinutes(60), "1h", "60");
  assertEqual(formatSlaMinutes(1680), "1d 4h", "1680");
  assertEqual(formatSlaMinutes(1440), "1d", "1440");
  assertEqual(formatSlaMinutes(90), "1h 30 mins", "90");
  assertEqual(formatSlaMinutes(1), "1 min", "1");
  assertEqual(formatSlaMinutes(0), "0 mins", "0");
}
