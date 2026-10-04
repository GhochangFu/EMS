import { describe, it } from "vitest";

import {
  assertADeepStoredDraftIsShedNotThrownOutOf,
  assertAResidualOverBudgetPayloadIsValidJson,
  assertAnUnderBudgetDraftIsForwardedIntact,
  assertAgentTurnForwardsABoundedPrompt,
  assertOverBudgetShedsTheFourRecordsFirst,
  assertOverBudgetThenShedsOverLongStrings,
  assertPromptStringMaxIsTheWidestNameColumn,
  assertShedFreeFormRecordsIsIterative,
  assertShedOverLongStringsIsIterative,
  assertTheBudgetIsMeasuredInBytesAtTheBound,
  assertTheMarkerEchoesNothing,
  assertShedTemplatePointsIsIterative,
  assertW7OverBudgetShedsTemplatePointsKeepingCodes,
  assertW8AnUnderBudgetDraftKeepsTemplatePoints,
} from "./onboarding-prompt-budget.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per exported assert-function, for the reason `F4.115`'s wrapper
 * records: a suite that ran every claim from one `it()` dies at its first
 * failing `assert` and proves nothing about the claims after it, which is
 * exactly what the mutation tables in
 * `docs/plans/f4.107-llm-prompt-forward-cap.md` §4 have to distinguish.
 */
describe("F4.107 — the draft forwarded to the model is bounded", () => {
  it("forwards a draft that fits the budget byte-for-byte", () => {
    assertAnUnderBudgetDraftIsForwardedIntact();
  });

  it("sheds the four free-form records first, keeping every code and name", () => {
    assertOverBudgetShedsTheFourRecordsFirst();
  });

  it("then sheds strings wider than any code or name column", () => {
    assertOverBudgetThenShedsOverLongStrings();
  });

  it("pins the string bound to the widest code/name column", () => {
    assertPromptStringMaxIsTheWidestNameColumn();
  });

  it("sheds a 20,000-deep stored draft instead of throwing out of it", () => {
    assertADeepStoredDraftIsShedNotThrownOutOf();
  });

  it("walks the first shed pass iteratively, past a key it does not shed", () => {
    assertShedFreeFormRecordsIsIterative();
  });

  it("walks the second shed pass iteratively too", () => {
    assertShedOverLongStringsIsIterative();
  });

  it("replaces a value with a marker that echoes nothing about it", () => {
    assertTheMarkerEchoesNothing();
  });

  it("measures the budget in bytes, at the bound", () => {
    assertTheBudgetIsMeasuredInBytesAtTheBound();
  });

  it("returns valid untruncated JSON when the residual is still over budget", () => {
    assertAResidualOverBudgetPayloadIsValidJson();
  });

  it("hands the agent's first model call a draft context within the budget", async () => {
    await assertAgentTurnForwardsABoundedPrompt();
  });
});

describe("F3.22 — template points are shed before over-long strings", () => {
  it("W7 sheds every template's points over budget and keeps every code", () => {
    assertW7OverBudgetShedsTemplatePointsKeepingCodes();
  });

  it("W8 keeps template points verbatim under budget", () => {
    assertW8AnUnderBudgetDraftKeepsTemplatePoints();
  });

  it("sheds template points iteratively", () => {
    assertShedTemplatePointsIsIterative();
  });
});
