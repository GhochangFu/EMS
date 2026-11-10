import { describe, it } from "vitest";

import {
  aMalformedInputIsA400First,
  aNonAdminIsRefusedEveryRouteFirst,
  aReplaceWritesTheSet,
  eachRouteReachesItsServiceMethod,
  notFoundComesBeforeConflict,
  revokeIsFinal,
  revokeUnassignsInTheSameTransaction,
  theAssignmentRules,
  theListCarriesNoSecret,
  theMintStoresOnlyTheHash,
  theRoutesAreMounted,
  theTokenGeneratorMatchesTheReceiver,
} from "./edge-gateways.service.gates.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the edge gateway admin's gates (ADR 0123 decisions 5, 6, 12)", () => {
  it("G1 refuses a non-admin every route, the read included, before any statement", aNonAdminIsRefusedEveryRouteFirst);
  it("G2 answers 400 to a malformed id or body before any statement", aMalformedInputIsA400First);
  it("G3 answers 404 before any 409", notFoundComesBeforeConflict);
  it("G4 mints a token once and stores only its SHA-256 and last four", theMintStoresOnlyTheHash);
  it("G5 keeps revoke final", revokeIsFinal);
  it("G6 unassigns the RTUs in the revoke's transaction", revokeUnassignsInTheSameTransaction);
  it("G7 refuses a foreign RTU with a 404 and each ineligible RTU with a fixed 409", theAssignmentRules);
  it("G8 replaces the assigned set without writing an asset", aReplaceWritesTheSet);
  it("G9 lists gateways with no hash or token", theListCarriesNoSecret);
  it("G10 generates tokens the receiver accepts", theTokenGeneratorMatchesTheReceiver);
  it("G11 mounts the routes, the mint no-store", theRoutesAreMounted);
  it("G12 hands each service method the raw input", eachRouteReachesItsServiceMethod);
});
