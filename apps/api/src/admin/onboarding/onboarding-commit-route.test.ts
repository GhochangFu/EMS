import { describe, it } from "vitest";

import {
  aBadCommitBodyIsA400,
  aHashedCommitIsBoundToThatDraft,
  anEmptyOrMissingBodyIsA400,
  theRoutePassesTheHashThrough,
} from "./onboarding-commit-route.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 5 — the onboarding commit route requires a draftHash (ADR 0099 decision 7)", () => {
  it("answers 400 for {} and for a missing body, and commits nothing", () => anEmptyOrMissingBodyIsA400());
  it("binds a hashed commit to that draft through commitProposed", () => aHashedCommitIsBoundToThatDraft());
  it("passes the body's hash to the service", () => theRoutePassesTheHashThrough());
  it("answers 400 for a bad body and commits nothing", () => aBadCommitBodyIsA400());
});
