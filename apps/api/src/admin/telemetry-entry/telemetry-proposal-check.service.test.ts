import { describe, it } from "vitest";

import {
  aMappingNeededReadingIsNamedInTheNote,
  anImportRowInAnotherOrganizationNamesItsRow,
  anOutOfOrganizationReadingNamesItsRow,
  anUnknownImportAssetIsTheRoutesSentence,
  aRouteRejectedReadingIsTheRoutesSentence,
  theImportCountsPassThroughUnchanged,
  theImportMappingsAreTheValidatedRowsThatNeedOne,
  theImportNoteNamesCountsAndAMapping,
} from "./telemetry-proposal-check.service.spec";

/** `F4.283` — Vitest entry point for the telemetry proposal check. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.283 — the copilot's telemetry proposal check (ADR 0099 Amendment 8 Q18, Q21)", () => {
  it("an out-of-organization reading names its row", () => anOutOfOrganizationReadingNamesItsRow());
  it("a route-rejected reading is the route's sentence with its row", () => aRouteRejectedReadingIsTheRoutesSentence());
  it("a reading that needs a mapping is named CODE/pointKey in the note", () => aMappingNeededReadingIsNamedInTheNote());
  it("the import counts pass through unchanged; the card keeps 20 rejected rows", () => theImportCountsPassThroughUnchanged());
  it("the import note names the counts and a mapping", () => theImportNoteNamesCountsAndAMapping());
});

describe("F4.283 — TelemetryImportService.previewForProposal (ADR 0099 Amendment 8 Q21)", () => {
  it("an import row in another organization names its sheet row", () => anImportRowInAnotherOrganizationNamesItsRow());
  it("an unknown import asset is the route's sentence with its sheet row", () => anUnknownImportAssetIsTheRoutesSentence());
  it("the mappings are the validated rows that need one", () => theImportMappingsAreTheValidatedRowsThatNeedOne());
});
