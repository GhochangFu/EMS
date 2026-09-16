import { describe, it } from "vitest";

import {
  a413NamesTenMbNotFiveMb,
  aConflictEnvelopeIsUnwrapped,
  aValidFileUnderTheCapIsNotBlocked,
  anEmptyBodyNamesTheStatus,
  anOversizeFileNamesTheLimitAndItsOwnSize,
  anUnsupportedTypeIsRefused,
  galleryFiveHundredShowsTheGenericSentence,
  galleryFiveOhThreeShowsTheApiSentence,
  galleryFiveOhThreeWithANonEnvelopeBodyShowsTheStorageSentence,
  galleryFiveOhThreeWithAnArrayMessageShowsTheJoinedSentence,
  galleryFiveOhThreeWithATruncatedJsonBodyShowsTheStorageSentence,
  galleryFiveOhThreeWithNoBodyShowsTheStorageSentence,
  megabytesIsTenFromTheSharedConstant,
  noFileNamesItself,
  theAcceptStringIsDerivedFromTheThreeTypes,
  theCapReasonIsTheSentenceAtTwentyAndNullBelow,
  theCapSentenceNamesTwenty,
} from "./asset-images-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.4 asset-images-view", () => {
  it("derives the accept string from the shared content-type vocabulary", () => {
    theAcceptStringIsDerivedFromTheThreeTypes();
  });

  it("reads 10 from the shared byte constant", () => {
    megabytesIsTenFromTheSharedConstant();
  });

  it("does not block a valid file under the cap", () => {
    aValidFileUnderTheCapIsNotBlocked();
  });

  it("names no-file first", () => {
    noFileNamesItself();
  });

  it("names 20 at the cap and says to delete one first", () => {
    theCapSentenceNamesTwenty();
  });

  it("names the cap on its own at 20 and nothing at 19", () => {
    theCapReasonIsTheSentenceAtTwentyAndNullBelow();
  });

  it("refuses a type outside the closed vocabulary", () => {
    anUnsupportedTypeIsRefused();
  });

  it("names the 10 MB limit and the file's own size when oversize", () => {
    anOversizeFileNamesTheLimitAndItsOwnSize();
  });

  it("names 10 MB, not the telemetry-import sibling's 5 MB, on a 413", () => {
    a413NamesTenMbNotFiveMb();
  });

  it("unwraps a 409 conflict envelope to its own sentence", () => {
    aConflictEnvelopeIsUnwrapped();
  });

  it("names the status when the upload body is empty", () => {
    anEmptyBodyNamesTheStatus();
  });

  it("shows the API's own sentence on a gallery 503", () => {
    galleryFiveOhThreeShowsTheApiSentence();
  });

  it("shows the storage sentence on a gallery 503 with an empty body", () => {
    galleryFiveOhThreeWithNoBodyShowsTheStorageSentence();
  });

  it("shows the storage sentence on a gallery 503 whose body is not an envelope", () => {
    galleryFiveOhThreeWithANonEnvelopeBodyShowsTheStorageSentence();
  });

  it("shows the storage sentence on a gallery 503 whose body is truncated JSON", () => {
    galleryFiveOhThreeWithATruncatedJsonBodyShowsTheStorageSentence();
  });

  it("joins an envelope whose message is an array on a gallery 503", () => {
    galleryFiveOhThreeWithAnArrayMessageShowsTheJoinedSentence();
  });

  it("shows the generic sentence on any other gallery status", () => {
    galleryFiveHundredShowsTheGenericSentence();
  });
});
