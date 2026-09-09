import { describe, it, vi } from "vitest";

/**
 * The repo's first `vi.mock` (decision 5), and it is here rather than in the
 * spec because `vi.mock` is hoisted above the imports and only a Vitest file may
 * declare it. The assertions stay in the spec (ADR 0014); this captures what the
 * `openai` client's `create()` was handed and passes it across.
 *
 * `vi.hoisted` for the same reason: the factory runs before this module's own
 * bindings exist, so the array has to be created above them too.
 *
 * What the alternative would have proved: a textual pin under `tests/` on the
 * chat service's call site names the function and nothing else. This measures
 * the bytes.
 */
const captured = vi.hoisted(() => ({ requests: [] as unknown[] }));

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (request: unknown): Promise<unknown> => {
          captured.requests.push(request);
          return { choices: [{ message: { content: "{}" } }] };
        },
      },
    };
  },
}));

import {
  assertADeepStoredDraftIsShedNotThrownOutOf,
  assertAResidualOverBudgetPayloadIsValidJson,
  assertAnUnderBudgetDraftIsForwardedIntact,
  assertOpenAiTurnForwardsABoundedPrompt,
  assertOverBudgetShedsTheFourRecordsFirst,
  assertOverBudgetThenShedsOverLongStrings,
  assertPromptStringMaxIsTheWidestNameColumn,
  assertShedFreeFormRecordsIsIterative,
  assertShedOverLongStringsIsIterative,
  assertTheBudgetIsMeasuredInBytesAtTheBound,
  assertTheMarkerEchoesNothing,
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

  it("hands the OpenAI call a draft context within the budget", async () => {
    await assertOpenAiTurnForwardsABoundedPrompt(captured.requests);
  });
});
