import { describe, it } from "vitest";

import {
  anUpdateSummaryNamesOnlyTheFieldsSent,
  bothAreOfferedToTheGlobalAdminAlone,
  theBodiesAreTheRoutesOwnSchemas,
  theCreateIsAFleetPost,
  theDeleteStaysExcluded,
  theStepsNameTheWritableFields,
  theSummariesSayFleetWideAndNeverTheOrganization,
  theUpdateIsAPatchOfTheRow,
  theUpdateTargetsThePointKeyStateRow,
  theWritesAreNoLongerPending,
} from "./point-key-states.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.309 PR 3 — the pointKeyState catalog entries (ADR 0099 Amendment 13)", () => {
  it("makes the create a POST of the collection on a fleet target", () => theCreateIsAFleetPost());
  it("makes the edit a PATCH of the row, its id a uuid", () => theUpdateIsAPatchOfTheRow());
  it("targets the edit at the pointKeyState row by its id", () => theUpdateTargetsThePointKeyStateRow());
  it("carries the routes' own body schemas, by identity", () => theBodiesAreTheRoutesOwnSchemas());
  it("offers both entries to the global admin alone", () => bothAreOfferedToTheGlobalAdminAlone());
  it("steps through the writable fields only", () => theStepsNameTheWritableFields());
  it("says fleet-wide in each summary and never names the bound organization", () =>
    theSummariesSayFleetWideAndNeverTheOrganization());
  it("names only the fields an edit sends", () => anUpdateSummaryNamesOnlyTheFieldsSent());
  it("keeps the DELETE excluded and off the allowance", () => theDeleteStaysExcluded());
  it("takes the POST and the PATCH off the pending list", () => theWritesAreNoLongerPending());
});
