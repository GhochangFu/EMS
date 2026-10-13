import { describe, it } from "vitest";

import {
  aCallerWithNoHomeIsA400,
  aGlobalAdminWithNoOrganizationIsA400,
  aHomeOutsideTheScopeIsA403,
  aLocationAdminWithNoOrganizationIsTheRole403,
  aScopedAdminWithNoOrganizationListsItsHome,
  theHomeOrganizationIsScopeChecked,
  aLocationAdminCannotListDrafts,
  anUnknownPhaseFailsTheServerParse,
  eachProjectedColumnIsTheIntendedOne,
  theJoinMatchesTheStarterColumn,
  anOrganizationOutsideTheScopeIsA403,
  anUnknownOrganizationIsA404,
  theListAnswersTheSummary,
  theListIsBoundedByTheSharedLimit,
  theListIsNewestUpdateFirst,
  theListJoinsTheStarterFromUsers,
  theListKeepsOnlyDrafts,
  theListKeepsOnlyTheNamedOrganization,
  theListNeverSelectsTheDraft,
  theStarterMapsToNullOrTheUser,
} from "./onboarding-list-drafts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.255 — the organization's onboarding draft list (ADR 0099 Amendment 2 A1)", () => {
  it("refuses a location admin with the role sentence before any read", () => aLocationAdminCannotListDrafts());
  it("refuses an organization outside the scope with a 403 before any read", () => anOrganizationOutsideTheScopeIsA403());
  it("answers 404 for an unknown organization and reads no list", () => anUnknownOrganizationIsA404());
  it("keeps only drafts", () => theListKeepsOnlyDrafts());
  it("keeps only the named organization", () => theListKeepsOnlyTheNamedOrganization());
  it("never selects the draft column", () => theListNeverSelectsTheDraft());
  it("maps the starter to null or the user", () => theStarterMapsToNullOrTheUser());
  it("reads the sessions and joins the starter from users", () => theListJoinsTheStarterFromUsers());
  it("joins users.id = onboarding_sessions.created_by", () => theJoinMatchesTheStarterColumn());
  it("projects each intended column", () => eachProjectedColumnIsTheIntendedOne());
  it("answers the 500 server fault for a stored phase outside the enum", () => anUnknownPhaseFailsTheServerParse());
  it("is newest update first", () => theListIsNewestUpdateFirst());
  it("is bounded by the shared limit", () => theListIsBoundedByTheSharedLimit());
  it("answers the summary DTO", () => theListAnswersTheSummary());
});

describe("F4.255 — the draft list with no organization named: the caller's home organization", () => {
  it("lists a scoped administrator's home organization", () => aScopedAdminWithNoOrganizationListsItsHome());
  it("scope-checks the home organization", () => theHomeOrganizationIsScopeChecked());
  it("refuses a home organization outside the scope with a 403 before any read", () => aHomeOutsideTheScopeIsA403());
  it("answers 400 to a global administrator who names none, before any read", () => aGlobalAdminWithNoOrganizationIsA400());
  it("answers 400 to a caller with no home organization, before any read", () => aCallerWithNoHomeIsA400());
  it("runs the role gate first", () => aLocationAdminWithNoOrganizationIsTheRole403());
});
