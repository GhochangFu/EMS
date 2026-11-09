import { describe, it } from "vitest";

import {
  aBadDefinitionAnswersIssuesWithoutEchoingValues,
  aCodeReturnsOneFormatWithItsDefinition,
  aDecodeLogsNoSample,
  anUndecodableSampleAnswersTheReason,
  aTenantAdministratorIsRefusedBothTools,
  listsEveryFormatWithItsScopedRtuCount,
  theBcplGoldenSampleDecodes,
  theListTakesOnlyACode,
  theSchemaBoundsTheSampleAndTakesNoCredential,
  theServiceCountsPerOrganizationOnTheTenantPool,
  theServicesRowsAreParsed,
  aHexSampleDecodesABinaryFormat,
} from "./payload-format-read-tools.spec";

/** `F4.334` PR 5 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.334 PR 5 — list_payload_formats and decode_payload_sample (ADR 0099 Amendment 17 decisions 2, 3)", () => {
  it("lists each format with its RTU count from the allowed organizations only, no definition body", () =>
    listsEveryFormatWithItsScopedRtuCount());
  it("returns one format with its definition for a code", () => aCodeReturnsOneFormatWithItsDefinition());
  it("refuses every role but the global admin before any read or decode", () => aTenantAdministratorIsRefusedBothTools());
  it("parses the stored rows through the guarded parse", () => theServicesRowsAreParsed());
  it("decodes the BCPL golden sample to its two readings", () => theBcplGoldenSampleDecodes());
  it("answers the decoder's reason for a sample it cannot read", () => anUndecodableSampleAnswersTheReason());
  it("answers a bad definition's issues without echoing a value", () => aBadDefinitionAnswersIssuesWithoutEchoingValues());
  it("bounds the sample at 16 KiB and takes no credential field", () => theSchemaBoundsTheSampleAndTakesNoCredential());
  it("takes only an optional code on the list", () => theListTakesOnlyACode());
  it("logs no sample", () => aDecodeLogsNoSample());
  it("counts per allowed organization on the tenant pool, global admin only", () =>
    theServiceCountsPerOrganizationOnTheTenantPool());
  it("F4.343 decodes a hex sample with a binary format and refuses bad hex first", () => aHexSampleDecodesABinaryFormat());
});
