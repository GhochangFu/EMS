import { expect } from "vitest";

import { priorityRailStyle, priorityStyle } from "./work-orders-page";

/**
 * `F3.65b` owner ruling R-f (2026-09-28) — priority `high` and `medium` must not
 * look the same. The palette migration merged both onto the warning pill; the
 * ruling splits them again with existing roles only: `high` takes the solid
 * warning line and the strong wash, `medium` the soft line and the plain wash;
 * the kanban card's left rail is solid for `high` and half-opacity for `medium`.
 *
 * Assertions live here; `work-orders-page.test.tsx` is the Vitest entry point
 * (ADR 0014).
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

export function highAndMediumRailsDiffer(): void {
  expect(priorityRailStyle("high")).not.toBe(priorityRailStyle("medium"));
}

export function mediumRailIsTheHalfOpacityWarning(): void {
  expect(priorityRailStyle("medium")).toBe("border-l-warning/50");
}
