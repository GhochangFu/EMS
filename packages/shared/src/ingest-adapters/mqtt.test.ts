import { describe, it } from "vitest";

import {
  assertNoDraftIssueMessageEchoesAValue,
  assertTheConfigSchemaDefaultsTlsVerificationOn,
  assertTheConfigSchemaRefusesAStringOrZeroPort,
  assertTheDeviceSchemaAcceptsAnOrdinaryTopic,
  assertTheDeviceSchemaRefusesAWildcardTopic,
  assertTheDraftSchemaAcceptsAnAbsentHostAndPort,
  assertTheDraftSchemaChecksEveryPresentField,
  assertTheDraftSchemaKeepsAnEmptyTopicAndDraftOnlyKeys,
  assertTheDraftSchemaRefusesRejectUnauthorized,
} from "./mqtt.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24a — the shared MQTT schemas (ADR 0093 decision 4)", () => {
  it("S1 refuses a wildcard device topic", () => {
    assertTheDeviceSchemaRefusesAWildcardTopic();
  });

  it("S2 accepts one device's topic", () => {
    assertTheDeviceSchemaAcceptsAnOrdinaryTopic();
  });

  it("S3 defaults TLS peer verification on", () => {
    assertTheConfigSchemaDefaultsTlsVerificationOn();
  });

  it("S4 refuses a string or zero port", () => {
    assertTheConfigSchemaRefusesAStringOrZeroPort();
  });

  it("S5 lets a draft leave host and port to the env fallback", () => {
    assertTheDraftSchemaAcceptsAnAbsentHostAndPort();
  });

  it("S6 checks every present draft field and names its path", () => {
    assertTheDraftSchemaChecksEveryPresentField();
  });

  it("S7 keeps an empty draft topic and draft-only keys", () => {
    assertTheDraftSchemaKeepsAnEmptyTopicAndDraftOnlyKeys();
  });

  it("S8 refuses a draft that sets rejectUnauthorized", () => {
    assertTheDraftSchemaRefusesRejectUnauthorized();
  });

  it("S9 never echoes the offending value in an issue message", () => {
    assertNoDraftIssueMessageEchoesAValue();
  });
});
