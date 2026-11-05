import { describe, it } from "vitest";

import {
  theAdoptRouteIsNotPending,
  theBodyIsTheRoutesOwnSchema,
  theCardIsRed,
  theEntryIsAPost,
  theEntryIsTheAdoptPath,
  thePreviewStaysPending,
  theRiskIsEdit,
  theSummaryNamesTheBatchAndSaysItIsOneWay,
  theTargetIsTheAdoptKind,
  theVersionIsThePathsId,
} from "./asset-template-adopt.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 PR 2 — the assetTemplate.adopt catalog entry (ADR 0099 Amendment 12)", () => {
  it("is a POST", () => theEntryIsAPost());
  it("is the adopt route's path", () => theEntryIsTheAdoptPath());
  it("names the version by the path's id", () => theVersionIsThePathsId());
  it("has risk edit", () => theRiskIsEdit());
  it("carries the route's own body schema, by identity", () => theBodyIsTheRoutesOwnSchema());
  it("is a red Confirm card", () => theCardIsRed());
  it("targets the version and the listed assets with assetTemplateAdopt", () => theTargetIsTheAdoptKind());
  it("takes the adopt route off the pending list", () => theAdoptRouteIsNotPending());
  it("keeps the adoption preview pending", () => thePreviewStaysPending());
  it("summarises the batch and says it is one-way", () => theSummaryNamesTheBatchAndSaysItIsOneWay());
});
