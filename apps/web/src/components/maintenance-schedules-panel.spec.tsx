import { expect } from "vitest";

import { priorityStyle } from "./maintenance-schedules-panel";

/**
 * `F3.65b` owner ruling R-f (2026-09-28) — the schedule template's priority
 * pill uses the same split as the work-orders page: `high` on the solid warning
 * line and the strong wash, `medium` on the soft line and the plain wash.
 *
 * Assertions live here; `maintenance-schedules-panel.test.tsx` is the Vitest
 * entry point (ADR 0014).
 */

export function highAndMediumPillsDiffer(): void {
  expect(priorityStyle("high")).not.toBe(priorityStyle("medium"));
}

export function highPillIsTheRuledStrongWarning(): void {
  expect(priorityStyle("high")).toBe("border-warning bg-warning-wash-strong text-warning-ink");
}

export function mediumPillIsTheRuledSoftWarning(): void {
  expect(priorityStyle("medium")).toBe("border-warning-line bg-warning-wash text-warning-ink");
}
