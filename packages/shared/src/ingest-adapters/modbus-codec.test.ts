import { describe, it } from "vitest";

import {
  assertABoolRegisterOfZeroIsFalse,
  assertAShortFrameIsAnError,
  assertAWrongByteCountIsAnError,
  assertAWordOutsideSixteenBitsIsAnError,
  assertAnAduLengthOutside2To254IsAnError,
  assertDataBytesThatDisagreeWithTheByteCountAreAnError,
  assertAWrongFunctionCodeIsAnError,
  assertEachDocumentReplyDecodesToItsValues,
  assertEachDocumentRequestEncodesToItsBytes,
  assertEveryTypeDecodesInEveryLayout,
  assertOnlyReadFunctionCodesEncode,
  assertOutOfRangeValuesAreReportedNotRounded,
  assertRequestQuantityAndAddressAreBounded,
  assertTheAssemblerJoinsOneFrameFromThreeChunks,
  assertTheAssemblerRefusesALengthOf255,
  assertTheAssemblerRefusesAnotherProtocol,
  assertTheAssemblerSplitsTwoFramesFromOneChunk,
  assertTheExceptionReplyDecodesToItsCode,
  assertTheGuideAduDecodesToItsFields,
  assertTheGuideAduEncodesToItsBytes,
  assertTheServerAnswersABadQuantityWithException03,
  assertTheServerAnswersAnAddressOutsideTheImageWithException02,
  assertTheServerAnswersAnyOtherFunctionWithException01,
  assertTheServerAnswersEachDocumentRequestWithItsReply,
  assertTheServerDropsAFrameItCannotParse,
  assertTooFewWordsIsAnError,
} from "./modbus-codec.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the Modbus codec against the specification (plan T1.3, T1.4)", () => {
  it("C1 encodes each document request PDU to its bytes", () => {
    assertEachDocumentRequestEncodesToItsBytes();
  });

  it("C2 encodes the guide's request ADU to its bytes", () => {
    assertTheGuideAduEncodesToItsBytes();
  });

  it("C3 decodes the guide's ADU header", () => {
    assertTheGuideAduDecodesToItsFields();
  });

  it("C4 encodes function codes 1-4 and refuses every other", () => {
    assertOnlyReadFunctionCodesEncode();
  });

  it("C5 bounds quantity, address, transaction id and unit id", () => {
    assertRequestQuantityAndAddressAreBounded();
  });

  it("C6 decodes each document reply to its values", () => {
    assertEachDocumentReplyDecodesToItsValues();
  });

  it("C7 decodes the exception reply to its code", () => {
    assertTheExceptionReplyDecodesToItsCode();
  });

  it("C8 refuses a wrong byte count", () => {
    assertAWrongByteCountIsAnError();
  });

  it("C9 refuses a wrong function code", () => {
    assertAWrongFunctionCodeIsAnError();
  });

  it("C10 refuses a short or inconsistent frame", () => {
    assertAShortFrameIsAnError();
  });

  it("C11 decodes each of the nine types in each wordOrder and byteSwap", () => {
    assertEveryTypeDecodesInEveryLayout();
  });

  it("C12 reads a zero register as bool false", () => {
    assertABoolRegisterOfZeroIsFalse();
  });

  it("C13 reports a 64-bit value past MAX_SAFE_INTEGER and a non-finite float as out of range", () => {
    assertOutOfRangeValuesAreReportedNotRounded();
  });

  it("C14 refuses too few words for the type", () => {
    assertTooFewWordsIsAnError();
  });

  it("C15 assembles two frames from one chunk", () => {
    assertTheAssemblerSplitsTwoFramesFromOneChunk();
  });

  it("C16 assembles one frame from three chunks", () => {
    assertTheAssemblerJoinsOneFrameFromThreeChunks();
  });

  it("C17 refuses a length field of 255", () => {
    assertTheAssemblerRefusesALengthOf255();
  });

  it("C18 refuses a non-zero protocol id", () => {
    assertTheAssemblerRefusesAnotherProtocol();
  });

  it("C19 refuses data bytes that disagree with a correct byte count", () => {
    assertDataBytesThatDisagreeWithTheByteCountAreAnError();
  });

  it("C20 refuses an ADU length field outside 2-254", () => {
    assertAnAduLengthOutside2To254IsAnError();
  });

  it("C21 refuses a word outside 0-65535", () => {
    assertAWordOutsideSixteenBitsIsAnError();
  });

  it("S1 serves each document request with the document's reply", () => {
    assertTheServerAnswersEachDocumentRequestWithItsReply();
  });

  it("S2 answers function codes 5 and 6 with exception 01", () => {
    assertTheServerAnswersAnyOtherFunctionWithException01();
  });

  it("S3 answers an address outside the image with exception 02", () => {
    assertTheServerAnswersAnAddressOutsideTheImageWithException02();
  });

  it("S4 answers a bad quantity with exception 03", () => {
    assertTheServerAnswersABadQuantityWithException03();
  });

  it("S5 drops a frame it cannot parse", () => {
    assertTheServerDropsAFrameItCannotParse();
  });
});
