import { describe, it } from "vitest";

import {
  assertBinaryPayloadIsRead,
  assertEmojiCutAtTheSampleBoundIsNotSplit,
  assertLoneSurrogateInDevIdIsRemoved,
  assertLoneSurrogateInKeyIsRemoved,
  assertLoneSurrogateInSampleIsRemoved,
  assertWholeEmojiInsideTheBoundIsKept,
  assertBrokerPasswordKeyIsSkipped,
  assertBrokerPasswordValueIsRedacted,
  assertControlCharsAreStripped,
  assertCredentialLookingDevIdIsSkipped,
  assertCredentialLookingSampleIsRedacted,
  assertDeviceCapTruncatesAndStops,
  assertGroupsByTopicThenDevice,
  assertInvalidJsonIsSkipped,
  assertMessageCapTruncatesAndStops,
  assertOverlongDevIdIsSkipped,
  assertOverlongKeyIsSkippedAndCounted,
  assertOverlongTopicIsSkipped,
  assertOversizePayloadIsSkipped,
  assertPerDeviceKeyCapTruncatesWithoutStopping,
  assertSampleValueRule,
  assertSecretNamedKeyIsRedacted,
  assertTotalKeyCapTruncatesAndStops,
} from "./discovery-collector.spec";

/** `F3.24b` (ADR 0103 decisions 5, 6) — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F3.24b — the discovery collector", () => {
  it("groups by topic, then dev_id, then key", () => assertGroupsByTopicThenDevice());

  describe("caps", () => {
    it("the message cap truncates and stops", () => assertMessageCapTruncatesAndStops());
    it("an oversize payload is counted and skipped", () => assertOversizePayloadIsSkipped());
    it("the device cap truncates and stops", () => assertDeviceCapTruncatesAndStops());
    it("the per-device key cap truncates without stopping", () => assertPerDeviceKeyCapTruncatesWithoutStopping());
    it("the total key cap truncates and stops", () => assertTotalKeyCapTruncatesAndStops());
    it("a 129-character key is counted and skipped", () => assertOverlongKeyIsSkippedAndCounted());
    it("a devId over 128 characters is skipped", () => assertOverlongDevIdIsSkipped());
    it("a topic over 255 characters is skipped", () => assertOverlongTopicIsSkipped());
  });

  describe("parsing", () => {
    it("skips invalid JSON, null and a missing dev_id", () => assertInvalidJsonIsSkipped());
    it("decodes a binary payload", () => assertBinaryPayloadIsRead());
    it("applies the sample-value rule", () => assertSampleValueRule());
  });

  describe("wire strings are untrusted (H2)", () => {
    it("strips control characters and line separators", () => assertControlCharsAreStripped());
    it("redacts a credential-looking sample", () => assertCredentialLookingSampleIsRedacted());
    it("redacts a password-named key's sample", () => assertSecretNamedKeyIsRedacted());
    it("redacts a sample equal to the broker password", () => assertBrokerPasswordValueIsRedacted());
    it("skips a key equal to the broker password", () => assertBrokerPasswordKeyIsSkipped());
    it("skips a devId equal to the broker password", () => assertCredentialLookingDevIdIsSkipped());
  });

  describe("every stored string is well-formed UTF-16 (Postgres jsonb)", () => {
    it("removes a lone surrogate from a devId", () => assertLoneSurrogateInDevIdIsRemoved());
    it("removes a lone surrogate from a key", () => assertLoneSurrogateInKeyIsRemoved());
    it("removes a lone surrogate from a sample", () => assertLoneSurrogateInSampleIsRemoved());
    it("does not split a surrogate pair at the sample bound", () => assertEmojiCutAtTheSampleBoundIsNotSplit());
    it("keeps a whole surrogate pair", () => assertWholeEmojiInsideTheBoundIsKept());
  });
});
