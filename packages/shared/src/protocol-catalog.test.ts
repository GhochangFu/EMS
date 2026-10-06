import { describe, it } from "vitest";

import {
  assertDescribeProtocolIsJsonSafe,
  assertIngestWiredIsDerivedFromTheWiredList,
  assertNoCatalogKeyIsACredentialKey,
  assertOneEntryPerOnboardingProtocolInDeclarationOrder,
  assertRequiredFieldsAreRequiredByTheDraftSchemaOnlyWhereItSaysSo,
  assertSupportsDiscoveryIsFalseEverywhereToday,
  assertTheMqttEntryCarriesTheDraftSchema,
} from "./protocol-catalog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24a — the protocol catalog (ADR 0093 decisions 2, 3)", () => {
  it("C1 has one entry per onboarding protocol, MQTT first", () => {
    assertOneEntryPerOnboardingProtocolInDeclarationOrder();
  });

  it("C2 derives ingestWired from INGEST_WIRED_PROTOCOLS, which is MQTT alone", () => {
    assertIngestWiredIsDerivedFromTheWiredList();
  });

  it("C3 marks no protocol as supporting discovery", () => {
    assertSupportsDiscoveryIsFalseEverywhereToday();
  });

  it("C4 names no credential key in any field list or example config", () => {
    assertNoCatalogKeyIsACredentialKey();
  });

  it("C5 gives MQTT the shared draft schema and every other protocol an open one", () => {
    assertTheMqttEntryCarriesTheDraftSchema();
  });

  it("C6 describes each protocol as JSON-safe data without the schema", () => {
    assertDescribeProtocolIsJsonSafe();
  });

  it("C7 requires topic for MQTT and nothing for an unwired protocol", () => {
    assertRequiredFieldsAreRequiredByTheDraftSchemaOnlyWhereItSaysSo();
  });
});
