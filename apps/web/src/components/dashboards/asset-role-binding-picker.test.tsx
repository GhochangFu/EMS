// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addIsDisabledUntilBothFieldsAreSet,
  addingABindingSendsBothFields,
  roleOptionsComeFromTheVocabularyFetch,
} from "./asset-role-binding-picker.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F3.36 asset role binding picker", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("builds the role options from the vocabulary fetch, never a hardcoded list", async () => {
    await roleOptionsComeFromTheVocabularyFetch();
  });

  it("sends both fields and clears only the point key", async () => {
    await addingABindingSendsBothFields();
  });

  it("keeps Add disabled until a role and a point key are both set", async () => {
    await addIsDisabledUntilBothFieldsAreSet();
  });
});
