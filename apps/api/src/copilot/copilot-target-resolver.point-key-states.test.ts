import { describe, it } from "vitest";

import {
  aCallerWhoIsNotTheGlobalAdminIsRefused,
  aCreateOfASeededPairIsRefused,
  anAdminRowResolvesByItsKeyValueAndLabel,
  anUnboundConversationIsRefused,
  anUnknownIdIsRefused,
  aSeededRowIsNoOpenWizardRecord,
  aSeededRowIsRefusedWithItsOwnSentence,
} from "./copilot-target-resolver.point-key-states.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.309 PR 3 — the pointKeyState target (ADR 0099 Amendment 13 decisions 1, 4; ruling Q2)", () => {
  it("resolves an admin row in the bound organization, named by its key, value and label", () =>
    anAdminRowResolvesByItsKeyValueAndLabel());
  it("refuses an unknown id", () => anUnknownIdIsRefused());
  it("refuses a caller who is not the global admin, seeded rows included", () => aCallerWhoIsNotTheGlobalAdminIsRefused());
  it("refuses an edit of a seeded row at propose with its own sentence", () => aSeededRowIsRefusedWithItsOwnSentence());
  it("finds no open-wizard record on a seeded row, and the admin row's", () => aSeededRowIsNoOpenWizardRecord());
  it("refuses a create of a seeded pair at propose, and resolves any other pair", () => aCreateOfASeededPairIsRefused());
  it("refuses a conversation bound to no organization before any read", () => anUnboundConversationIsRefused());
});
