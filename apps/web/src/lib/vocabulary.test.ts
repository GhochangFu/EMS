import { describe, it } from "vitest";

import { runVocabularyTests } from "./vocabulary.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("vocabulary", () => {
  it("renders a badge for every tone, and degrades to plain rather than wrong", () => {
    runVocabularyTests();
  });
});
