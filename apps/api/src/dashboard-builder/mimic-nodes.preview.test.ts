import { describe, it } from "vitest";

import {
  previewAnswersOneLayoutWidgetUnderTheLayoutId,
  previewOfALayoutTheOrganizationDoesNotHoldIsEmpty,
  previewReadsNoDashboardAndWritesNothing,
  previewResolvesRoledUnitsAgainstTheGivenGroup,
  previewWithNoReadableAssetSendsNoMembersStatement,
} from "./mimic-nodes.preview.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.308 — MimicNodesService.readLayoutPreview over a scripted pool", () => {
  it("U1 answers one layout widget under the layout id", previewAnswersOneLayoutWidgetUnderTheLayoutId);
  it("U2 resolves roled units against the given group", previewResolvesRoledUnitsAgainstTheGivenGroup);
  it("U3 reads no dashboard table and writes nothing", previewReadsNoDashboardAndWritesNothing);
  it("U4 no readable asset sends no members statement", previewWithNoReadableAssetSendsNoMembersStatement);
  it("U5 a layout the organization does not hold answers no widget", previewOfALayoutTheOrganizationDoesNotHoldIsEmpty);
});
