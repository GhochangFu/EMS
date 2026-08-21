import { describe, it } from "vitest";

import {
  runCleanTabTests,
  runDirtyTabTests,
  runLabelSourceTests,
  runPromptContentTests,
  runSameTabTests,
} from "./template-tab-guard.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template tab guard", () => {
  it("never prompts when the open tab is re-selected", () => {
    runSameTabTests();
  });

  it("lets a clean tab hand over silently", () => {
    runCleanTabTests();
  });

  it("blocks every switch away from a dirty tab", () => {
    runDirtyTabTests();
  });

  it("gives the dialog a prompt and two labelled buttons", () => {
    runPromptContentTests();
  });

  it("takes its labels from the tab registry", () => {
    runLabelSourceTests();
  });
});
