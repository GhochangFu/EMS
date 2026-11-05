import { describe, it } from "vitest";

import {
  onlyThePreviewStaysPending,
  theBodyIsTheRoutesOwnSchema,
  theCardIsRed,
  theEntryIsTheAdoptRoute,
  theSummaryNamesTheBatchAndSaysItIsOneWay,
  theTargetIsTheAdoptKind,
} from "./asset-template-adopt.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 PR 2 — the assetTemplate.adopt catalog entry (ADR 0099 Amendment 12)", () => {
  it("is the adopt route, risk edit", () => theEntryIsTheAdoptRoute());
  it("carries the route's own body schema, by identity", () => theBodyIsTheRoutesOwnSchema());
  it("is a red Confirm card", () => theCardIsRed());
  it("targets the version and the listed assets with assetTemplateAdopt", () => theTargetIsTheAdoptKind());
  it("leaves only the adoption preview pending", () => onlyThePreviewStaysPending());
  it("summarises the batch and says it is one-way", () => theSummaryNamesTheBatchAndSaysItIsOneWay());
});
