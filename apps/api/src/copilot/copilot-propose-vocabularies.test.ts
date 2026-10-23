import { describe, it } from "vitest";

import {
  aFixedBodyToolDefinesNoBody,
  aFixedBodyToolRefusesABody,
  aFixedBodyToolStoresTheFixedBody,
  aVocabularyChangeNeedsABoundConversation,
  aVocabularyToolCalledByIsRefused,
  REFUSED_ROLES,
  theAdminsMissingRoleSentenceTriesReactivateFirst,
  theRoleListNamesTheReactivatePath,
  theDeactivateCardStatesTheUsage,
  theReactivateToolStoresActiveTrue,
  theRoleEditFillRefusesActive,
  theRoleEditRefusesActive,
  theVocabularyToolsAreAbsentFor,
  theVocabularyToolsAreInTheGlobalAdminsRegistry,
} from "./copilot-propose-vocabularies.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.282 — the vocabulary propose tools (ADR 0099 Amendment 8, Q17)", () => {
  it("names the seven tools in the global admin's registry", () => theVocabularyToolsAreInTheGlobalAdminsRegistry());
  for (const role of REFUSED_ROLES) {
    it(`names none of the seven in the ${role} registry`, () => theVocabularyToolsAreAbsentFor(role));
    it(`refuses a direct call by an ${role}`, () => aVocabularyToolCalledByIsRefused(role));
  }
  it("refuses a vocabulary change in an unbound conversation", () => aVocabularyChangeNeedsABoundConversation());
  it("defines no body for a fixed-body tool", () => aFixedBodyToolDefinesNoBody());
  it("refuses a body sent to a fixed-body tool", () => aFixedBodyToolRefusesABody());
  it("stores the fixed body and its hash", () => aFixedBodyToolStoresTheFixedBody());
  it("stores active true for the reactivate tool", () => theReactivateToolStoresActiveTrue());
  it("states the location count on the deactivate card", () => theDeactivateCardStatesTheUsage());
  it("refuses active in the role edit's body", () => theRoleEditRefusesActive());
  it("refuses active in a fill for the role edit", () => theRoleEditFillRefusesActive());
  it("tells a global admin to reactivate a missing layout role before a create", () =>
    theAdminsMissingRoleSentenceTriesReactivateFirst());
  it("names the reactivate path in the role list's description", () => theRoleListNamesTheReactivatePath());
});
