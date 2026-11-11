// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusedWriteShowsTheSentence,
  addingAnItemSendsItsTitleAndClearsTheInput,
  mandatoryItemsAreMarkedAndTheCountIsShown,
  notApplicableSendsItsResultAndResetSendsPending,
  readOnlyDisablesEveryControlAndHidesTheAddForm,
  tickingAnItemSendsDoneAndCallsOnChanged,
  untickingADoneItemSendsPending,
} from "./work-order-checklist.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 the work-order checklist (ADR 0122 decision 4)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sends done on a tick and calls onChanged", async () => {
    await tickingAnItemSendsDoneAndCallsOnChanged();
  });

  it("sends pending on an untick", async () => {
    await untickingADoneItemSendsPending();
  });

  it("marks mandatory items and shows the count", () => {
    mandatoryItemsAreMarkedAndTheCountIsShown();
  });

  it("sends not_applicable, and Reset sends pending", async () => {
    await notApplicableSendsItsResultAndResetSendsPending();
  });

  it("adds an item with its title and mandatory flag and clears the input", async () => {
    await addingAnItemSendsItsTitleAndClearsTheInput();
  });

  it("disables every control and hides the add form when read-only", () => {
    readOnlyDisablesEveryControlAndHidesTheAddForm();
  });

  it("shows the server's sentence on a refused write", async () => {
    await aRefusedWriteShowsTheSentence();
  });
});
