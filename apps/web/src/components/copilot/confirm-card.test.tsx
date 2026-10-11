// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetCopilotStore } from "../../stores/copilot-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  a409SaysTheChangeIsGone,
  aCreateCardReadsNoRecord,
  aFillStepReachesTheWizardStore,
  anArchiveCardIsRed,
  anEditCardComparesWithTheRecordNow,
  anErrorShowsOnTheCard,
  confirmSendsTheProposedChange,
  rejectCallsTheRejectRouteOnly,
  thePollStopsOnTheFollowUpsOutcome,
} from "./confirm-card.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetCopilotStore();
  resetWizardStore();
  window.localStorage.clear();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F3.85 PR 8 copilot Confirm card — Confirm, Reject and the record now (ADR 0099 decision 4)", () => {
  it("renders a proposal as a card and Confirm sends that change", () => confirmSendsTheProposedChange(), 10_000);
  it("stops the poll on the follow-up's outcome and holds Send meanwhile", () => thePollStopsOnTheFollowUpsOutcome(), 20_000);
  it("says a 409 change is gone and reloads the conversation", () => a409SaysTheChangeIsGone());
  it("shows another error on the card", () => anErrorShowsOnTheCard());
  it("calls only the reject route on Reject", () => rejectCallsTheRejectRouteOnly());
  it("styles a deactivating change red", () => anArchiveCardIsRed());
  it("compares an edit with the record now", () => anEditCardComparesWithTheRecordNow());
  it("reads no record for a create", () => aCreateCardReadsNoRecord());
  it("hands a fillStep to the wizard store", () => aFillStepReachesTheWizardStore());
});
