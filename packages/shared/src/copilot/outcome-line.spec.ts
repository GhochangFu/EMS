import { expect } from "vitest";

import { isCopilotOutcomeLine } from "./outcome-line";

/**
 * `F4.244` — the text shape of a confirmed change's outcome line, one
 * definition for the dock's wait and the API. `apps/api/src/copilot/copilot-awaiting-follow-up.spec.ts`
 * binds it to the producer (`changeOutcomeLine`). Vitest entry point: the sibling `.test.ts`.
 */

export function anAppliedLineIsAnOutcome(): void {
  expect(isCopilotOutcomeLine("Applied: Publish the template")).toBe(true);
}

export function aFailedLineIsAnOutcome(): void {
  expect(isCopilotOutcomeLine("Failed (HTTP 400): Publish the template")).toBe(true);
}

/** The Reject line is an action line too, and it is not a follow-up's outcome. */
export function aRejectedLineIsNotAnOutcome(): void {
  expect(isCopilotOutcomeLine("Rejected: Publish the template")).toBe(false);
}
