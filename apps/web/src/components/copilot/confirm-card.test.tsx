// @vitest-environment jsdom
import { focusManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetCopilotStore } from "../../stores/copilot-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  aClientOnlyFieldIsTypedOnTheCard,
  a5xxKeepsTheCardOpen,
  anAmbiguous409ListsTheCandidates,
  anUnavailableCopilotKeepsTheCardOpen,
  aRoutesOwn409ShowsItsSentence,
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

// `F3.86` PR 2: two entries that later PRs add (PR 4's `user.create` with a `clientOnly` field, PR 3d's
// site layout) are mocked into the catalog for the card's own rules; every other id reads the real one.
vi.mock("@bms/shared/copilot", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bms/shared/copilot")>();
  const { createUserBodySchema } = await import("@bms/shared");
  const base = real.catalogEntry("dashboardTemplate.publish");
  if (!base) throw new Error("dashboardTemplate.publish");
  const fixtures: Record<string, typeof base> = {
    "fixture.user.create": {
      ...base,
      id: "fixture.user.create",
      title: "Create a user",
      path: "/admin/users",
      params: {},
      body: createUserBodySchema,
      bodyName: "createUserBodySchema",
      clientOnly: ["temporaryPassword"],
      risk: "access",
    },
    "location.siteLayout.make": {
      ...base,
      id: "location.siteLayout.make",
      title: "Make the site layout",
      path: "/admin/locations/:id/site-layout",
      risk: "create",
    },
  };
  return { ...real, catalogEntry: (id: string) => fixtures[id] ?? real.catalogEntry(id) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetCopilotStore();
  resetWizardStore();
  focusManager.setFocused(undefined);
  window.localStorage.clear();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F3.85 PR 8 copilot Confirm card — Confirm, Reject and the record now (ADR 0099 decision 4)", () => {
  it("renders a proposal as a card and Confirm sends that change", () => confirmSendsTheProposedChange(), 10_000);
  it("stops the poll on the follow-up's outcome and holds Send meanwhile", () => thePollStopsOnTheFollowUpsOutcome(), 20_000);
  it("says a 409 change is gone and reloads the conversation", () => a409SaysTheChangeIsGone());
  it("shows a route's error on the card and closes it", () => anErrorShowsOnTheCard());
  it("shows a route's own 409 sentence, not 'gone'", () => aRoutesOwn409ShowsItsSentence());
  it("keeps the card open when the copilot is unavailable", () => anUnavailableCopilotKeepsTheCardOpen());
  it("keeps the card open on a 5xx", () => a5xxKeepsTheCardOpen(), 10_000);
  it("lists the candidates of an ambiguous site layout", () => anAmbiguous409ListsTheCandidates());
  it("takes a clientOnly value in a password box and sends it only", () => aClientOnlyFieldIsTypedOnTheCard());
  it("calls only the reject route on Reject", () => rejectCallsTheRejectRouteOnly());
  it("styles a deactivating change red", () => anArchiveCardIsRed());
  it("compares an edit with the record now", () => anEditCardComparesWithTheRecordNow());
  it("reads no record for a create", () => aCreateCardReadsNoRecord());
  it("hands a fillStep to the wizard store", () => aFillStepReachesTheWizardStore());
});
