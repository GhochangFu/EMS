import { describe, it } from "vitest";

import {
  runActionConsequenceTests,
  runActionCoverageTests,
  runCleanTabTests,
  runDirtyTabTests,
  runLabelSourceTests,
  runLifecycleGuardTests,
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

  it("blocks every lifecycle action over an unsaved edit", () => {
    runLifecycleGuardTests();
  });

  it("tells the author what each action does, and what Publish ships", () => {
    runActionConsequenceTests();
  });

  it("covers every action the capability table offers", () => {
    runActionCoverageTests();
  });
});
