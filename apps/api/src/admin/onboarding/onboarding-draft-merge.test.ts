import { describe, it } from "vitest";

import {
  assertW12AnUploadKeepsTemplatesAndReplacesAssets,
  assertW13AGuidedTurnLeavesTemplatesIntact,
  assertW1APatchWithoutTemplatesKeepsTheBase,
  assertW2APatchWithTemplatesReplacesThem,
  assertW3AnExplicitUndefinedKeepsTheBase,
} from "./onboarding-draft-merge.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("mergeDraftPatch — templates[] (F3.22, ADR 0091 decision 2)", () => {
  it("W1 keeps the base's templates when the patch has none", () => {
    assertW1APatchWithoutTemplatesKeepsTheBase();
  });

  it("W2 replaces the templates wholesale when the patch has them", () => {
    assertW2APatchWithTemplatesReplacesThem();
  });

  it("W3 keeps the base's templates on an explicit undefined", () => {
    assertW3AnExplicitUndefinedKeepsTheBase();
  });
});

describe("the producers that never write templates keep them (F3.22, ADR 0091 decision 11)", () => {
  it("W12 an upload replaces assets[] and keeps templates[]", () => {
    assertW12AnUploadKeepsTemplatesAndReplacesAssets();
  });

  it("W13 a guided turn leaves templates and assets[].template intact", async () => {
    await assertW13AGuidedTurnLeavesTemplatesIntact();
  });
});
