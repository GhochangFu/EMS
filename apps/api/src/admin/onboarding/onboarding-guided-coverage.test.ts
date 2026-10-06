import { describe, it } from "vitest";

import {
  assertEveryAgentOnlyToolHasAReason,
  assertEveryGuidedToolAnswersItsActionLine,
  assertNoGuidedTurnReadsTheOrganization,
  assertTheProofMapCoversEveryGuidedTool,
  assertTheTableAndTheRegistryNameTheSameTools,
} from "./onboarding-guided-coverage.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("guided-mode tool coverage (F3.27 U5, B7)", () => {
  it("classifies every registry tool and names no other", () => {
    assertTheTableAndTheRegistryNameTheSameTools();
  });

  it("gives every agent-only tool a reason that names a row or a decision", () => {
    assertEveryAgentOnlyToolHasAReason();
  });

  it("proves exactly the tools classified guided", () => {
    assertTheProofMapCoversEveryGuidedTool();
  });

  it("answers each guided tool's action line from its branch", async () => {
    await assertEveryGuidedToolAnswersItsActionLine();
  });

  it("reads nothing of the organization on any guided tool's turn (F3.26 review L4)", async () => {
    await assertNoGuidedTurnReadsTheOrganization();
  });
});
