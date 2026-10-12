import { describe, it } from "vitest";

import {
  aBadCommitBodyIsA400,
  aHashedCommitIsBoundToThatDraft,
  anEmptyCommitIsTheStoredDraft,
  theRoutePassesTheHashThrough,
} from "./onboarding-commit-route.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 5 — the onboarding commit route takes an optional draftHash (ADR 0099 decision 7)", () => {
  it("commits the stored draft for an empty body", () => anEmptyCommitIsTheStoredDraft());
  it("binds a hashed commit to that draft through commitProposed", () => aHashedCommitIsBoundToThatDraft());
  it("passes the body's hash to the service", () => theRoutePassesTheHashThrough());
  it("answers 400 for a bad body and commits nothing", () => aBadCommitBodyIsA400());
});
