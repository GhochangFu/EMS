import { expect } from "vitest";

import { ASSIGNEE_REFUSAL } from "./assignee";

/**
 * `F4.285` (ADR 0106 decision 6) — the one refusal sentence of the assignee check. The web
 * shows it through `apiErrorMessage` and the integration specs match on it, so a reworded
 * sentence must redden here. Vitest entry point: the sibling `.test.ts`.
 */
export function theRefusalIsTheOneSentence(): void {
  expect(ASSIGNEE_REFUSAL).toBe("Assignee is not an active user of the work order's organization");
}
