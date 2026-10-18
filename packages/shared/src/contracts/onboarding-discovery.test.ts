import { describe, it } from "vitest";

import * as S from "./onboarding-discovery.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24b — the discovery contracts (ADR 0103)", () => {
  it("accepts a prefix with no window", () => S.theBodyAcceptsAPrefixAndNoWindow());
  it("refuses a + wildcard prefix", () => S.theBodyRefusesAPlusWildcard());
  it("refuses a # wildcard prefix", () => S.theBodyRefusesAHashWildcard());
  it("refuses a $SYS prefix", () => S.theBodyRefusesASysPrefix());
  it("refuses an empty prefix", () => S.theBodyRefusesAnEmptyPrefix());
  it("refuses a 256-character prefix", () => S.theBodyRefusesA256CharPrefix());
  it("refuses a 4 s window", () => S.theBodyRefusesWindow4());
  it("refuses a 121 s window", () => S.theBodyRefusesWindow121());
  it("accepts a 120 s window", () => S.theBodyAcceptsWindow120());
  it("refuses an unknown body key", () => S.theBodyRefusesAnUnknownKey());
  it("never echoes the refused prefix", () => S.theBodyIssueNeverEchoesTheValue());
  it("refuses a session DTO without discovery", () => S.theSessionDtoRefusesAMissingDiscovery());
  it("accepts a session DTO with null discovery", () => S.theSessionDtoAcceptsANullDiscovery());
  it("accepts a session DTO with a discovery result", () => S.theSessionDtoAcceptsADiscoveryResult());
  it("refuses a 65-character sample string", () => S.theResultRefusesA65CharSample());
  it("refuses a sixth error class", () => S.theResultRefusesASixthErrorClass());
  it("accepts a known error class", () => S.theResultAcceptsAKnownErrorClass());
  it("refuses a 256-character device topic", () => S.theDeviceRefusesA256CharTopic());
  it("refuses a 129-character devId", () => S.theDeviceRefusesA129CharDevId());
  it("accepts a 255-character topic and a 128-character devId", () => S.theDeviceAccepts255And128());
  it("caps total keys per job at 5,000", () => S.theTotalKeysCapIs5000());
  it("parses the stored shape with queuedAt and counters", () => S.theStoredSchemaParsesQueuedAtAndCounters());
  it("requires queuedAt on the stored shape", () => S.theStoredSchemaRequiresQueuedAt());
  it("refuses the stored-only keys on the DTO", () => S.theDtoRefusesTheStoredOnlyKeys());
  it("maps the stored shape to the DTO without the stored-only keys", () => S.theMapperDropsTheStoredOnlyKeys());
  it("mirrors the onboarding bounds it restates", () => S.theMirroredBoundsEqualTheOnboardingConstants());
  it("accepts source discovery on an asset point", () => S.anAssetPointAcceptsSourceDiscovery());
  it("refuses source manual on an asset point", () => S.anAssetPointRefusesSourceManual());
});
