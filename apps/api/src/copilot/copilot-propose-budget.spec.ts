import { expect } from "vitest";

import { proposeHarness } from "./copilot-propose-tools.spec";

/**
 * The propose registry's per-turn budget, in its own file since `F4.282` Q8:
 * `copilot-propose-tools.spec.ts` is at the 1000-line cap (AGENTS.md §4.5).
 * The per-definition gate (`noToolDefinitionCarriesALargeBody`) stays there.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

/**
 * Every definition is sent on every turn. Release 1 (16 entries) was under
 * 20,000 characters; release 2 adds one tool per entry, and `fill_step` and
 * `describe_change` name every catalog id. Measured at PR 3c (33 entries):
 * 24,218, of which 20,851 without the access tools. The 16 entries of PRs 3a
 * and 3b bring the estimate to about 36,000 (about 9k tokens); the cap is that
 * plus headroom, not room to grow into.
 *
 * Owner ruling 2026-10-13 (`F4.254` ruling 4): 48,000, for the five
 * asset-template lifecycle tools (the plan estimated about 730 characters
 * each). Measured at `F4.254` PR 2: 37,492 over 51 definitions before, 39,682
 * over 55 after (the four authoring tools add 2,190). Measured at PR 3: 41,001
 * over 56 (the instantiate tool adds 1,319).
 *
 * Owner ruling 2026-10-16 (`F3.87`): 52,000, for the six library, symbol and
 * asset-role tools of PR 6b (5,138 characters together). Measured at PR 6b:
 * 48,027. The headroom is for the next release's entries, not this one's.
 * `F4.266` (C6): the layout body guide on both layout tools, 48,027 before, 49,745 after.
 *
 * Owner ruling 2026-10-23 (release 4): the measured size rounded up to the next thousand, plus 1,000
 * (74,000 until `F4.281`; 77,000 until `F4.283`; 79,000 until `F4.284`; 84,000 until `F4.289`; 87,000 since). Measured per row:
 * - `F4.282` measured 53,985;
 * - `F4.278` measured 60,492;
 * - `F4.279` measured 68,366;
 * - `F4.280` measured 72,289;
 * - `F4.281` measured 75,145;
 * - Owner ruling 2026-10-23 (release 4): F4.283 measured 77,677.
 * - Owner ruling 2026-10-23 (release 4): F4.284 measured 82,904.
 * - Owner ruling 2026-10-25 (release 4): F4.284 skill code measured 82,991 (under the bound, so it is unchanged).
 * - Owner ruling P4 2026-10-27 (release 5): F4.290 PR 1 measured 83,092 (`locationIds` on the save model body;
 *   under the bound, so it is unchanged).
 * - Owner ruling P4 2026-10-27 (release 5): F4.290 PR 2 measured 83,195 (PR 2 changes no propose tool), under the
 *   bound, so it is unchanged.
 * - Owner ruling P4 2026-10-27 (release 5): F4.289 PR 2 measured 85,419 over 105 definitions
 *   (`propose_rule_createBatch` is 2,185 of it); the bound is 87,000 (86,000 + 1,000).
 */
export function theToolDefinitionsStayInTheTurnBudget(): void {
  const h = proposeHarness();
  expect(JSON.stringify(h.tools.registry.definitions).length).toBeLessThan(87_000);
}
