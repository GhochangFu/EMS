// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusedSaveShowsTheSentence,
  aRetiredCodeStaysSelectable,
  readOnlyLocksTheFormAndHidesSave,
  saveIsDisabledWhenAnEntryIsTooShort,
  saveSendsTrimmedValuesWithNullForAnEmptyOne,
  theFieldsStartFromTheDetail,
} from "./work-order-root-cause-form.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 the work-order root-cause form (ADR 0122 decision 5)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts the four fields from the detail", async () => {
    await theFieldsStartFromTheDetail();
  });

  it("keeps a retired cause code selectable", async () => {
    await aRetiredCodeStaysSelectable();
  });

  it("sends trimmed values with null for an empty one", async () => {
    await saveSendsTrimmedValuesWithNullForAnEmptyOne();
  });

  it("disables Save when unchanged or an entry is too short", async () => {
    await saveIsDisabledWhenAnEntryIsTooShort();
  });

  it("locks the form when read-only", () => {
    readOnlyLocksTheFormAndHidesSave();
  });

  it("shows the server's sentence on a refused save", async () => {
    await aRefusedSaveShowsTheSentence();
  });
});
