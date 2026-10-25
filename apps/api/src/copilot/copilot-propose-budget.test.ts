import { describe, it } from "vitest";

import { theToolDefinitionsStayInTheTurnBudget } from "./copilot-propose-budget.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 3c / F4.282 Q8 — the propose tools' per-turn budget (ADR 0099)", () => {
  it("keeps the tool definitions in the per-turn budget", () => theToolDefinitionsStayInTheTurnBudget());
});
