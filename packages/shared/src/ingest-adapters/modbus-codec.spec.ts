import { expect } from "vitest";

import {
  MODBUS_MAX_LENGTH_FIELD,
  MODBUS_READ_FUNCTION_CODES,
  ModbusProtocolError,
  type ModbusImage,
  createMbapFrameAssembler,
  decodeAdu,
  decodeReadResponse,
  decodeRegisterValue,
  encodeReadRequest,
  encodeReadRequestPdu,
  serveModbusFrame,
} from "./modbus-codec";
import {
  EXCEPTION_EXAMPLE,
  GUIDE_REQUEST_ADU,
  OUT_OF_RANGE_WORDS,
  READ_COILS_EXAMPLE,
  READ_COILS_STATES,
  READ_DISCRETE_INPUTS_EXAMPLE,
  READ_DISCRETE_INPUTS_STATES,
  READ_EXAMPLES,
  READ_HOLDING_REGISTERS_EXAMPLE,
  READ_HOLDING_REGISTERS_VALUES,
  READ_INPUT_REGISTERS_EXAMPLE,
  READ_INPUT_REGISTERS_VALUES,
  VALUE_LAYOUT_EXAMPLES,
} from "./modbus-codec.fixtures";

/**
 * `F1.2` plan T1.3, T1.4 — the Modbus codec against the specification's own
 * bytes (`modbus-codec.fixtures.ts` names each section). No case here encodes
 * with the codec and decodes with it again: every expected value is a
 * document byte or a hand-written word.
 *
 * Assertions live here; `modbus-codec.test.ts` is the vitest entry point
 * (ADR 0014).
 */

const hex = (frame: Uint8Array | null) =>
  frame ? Array.from(frame, (byte) => byte.toString(16).padStart(2, "0")).join("") : "null";

/** Wraps a document PDU in an MBAP header written out by hand (GUIDE §3.1.3). */
const handAdu = (transactionId: number, unitId: number, pdu: Uint8Array): Uint8Array => {
  const length = pdu.length + 1;
  return Uint8Array.from([transactionId >> 8, transactionId & 0xff, 0, 0, length >> 8, length & 0xff, unitId, ...pdu]);
};

const reasonOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof ModbusProtocolError) return error.reason;
    throw error;
  }
  return "no error";
};

// ---- T1.3: requests --------------------------------------------------------

export function assertEachDocumentRequestEncodesToItsBytes(): void {
  for (const example of [...READ_EXAMPLES, EXCEPTION_EXAMPLE]) {
    const pdu = encodeReadRequestPdu({
      functionCode: example.functionCode,
      address: example.address,
      quantity: example.quantity,
    });
    expect(hex(pdu), example.source).toBe(hex(example.requestPdu));
  }
}

export function assertTheGuideAduEncodesToItsBytes(): void {
  const adu = encodeReadRequest({
    transactionId: GUIDE_REQUEST_ADU.transactionId,
    unitId: GUIDE_REQUEST_ADU.unitId,
    functionCode: GUIDE_REQUEST_ADU.functionCode,
    address: GUIDE_REQUEST_ADU.address,
    quantity: GUIDE_REQUEST_ADU.quantity,
  });
  expect(hex(adu)).toBe(hex(GUIDE_REQUEST_ADU.adu));
}

export function assertTheGuideAduDecodesToItsFields(): void {
  const adu = decodeAdu(GUIDE_REQUEST_ADU.adu);
  expect(adu.transactionId).toBe(0x1501);
  expect(adu.unitId).toBe(0xff);
  expect(hex(adu.pdu)).toBe("0300040001");
}

export function assertOnlyReadFunctionCodesEncode(): void {
  expect([...MODBUS_READ_FUNCTION_CODES]).toEqual([1, 2, 3, 4]);
  for (const functionCode of [0, 5, 6, 15, 16, 23, 0x81]) {
    expect(
      () => encodeReadRequestPdu({ functionCode: functionCode as 1, address: 0, quantity: 1 }),
      String(functionCode),
    ).toThrow(RangeError);
  }
}

export function assertRequestQuantityAndAddressAreBounded(): void {
  const encode = (functionCode: 1 | 2 | 3 | 4, address: number, quantity: number) => () =>
    encodeReadRequestPdu({ functionCode, address, quantity });
  expect(encode(3, 0, 125)).not.toThrow();
  expect(encode(3, 0, 126)).toThrow(RangeError);
  expect(encode(4, 0, 0)).toThrow(RangeError);
  expect(encode(1, 0, 2000)).not.toThrow();
  expect(encode(2, 0, 2001)).toThrow(RangeError);
  expect(encode(3, 65_535, 1)).not.toThrow();
  expect(encode(3, 65_535, 2)).toThrow(RangeError);
  expect(encode(3, -1, 1)).toThrow(RangeError);
  const read = { functionCode: 4, address: 8, quantity: 1 } as const;
  expect(() => encodeReadRequest({ ...read, transactionId: 0x1_0000, unitId: 1 })).toThrow(RangeError);
  expect(() => encodeReadRequest({ ...read, transactionId: 1, unitId: 256 })).toThrow(RangeError);
}

// ---- T1.3: replies ---------------------------------------------------------

export function assertEachDocumentReplyDecodesToItsValues(): void {
  expect(decodeReadResponse(READ_COILS_EXAMPLE.responsePdu, READ_COILS_EXAMPLE)).toEqual({
    kind: "bits",
    bits: READ_COILS_STATES,
  });
  expect(decodeReadResponse(READ_DISCRETE_INPUTS_EXAMPLE.responsePdu, READ_DISCRETE_INPUTS_EXAMPLE)).toEqual({
    kind: "bits",
    bits: READ_DISCRETE_INPUTS_STATES,
  });
  expect(decodeReadResponse(READ_HOLDING_REGISTERS_EXAMPLE.responsePdu, READ_HOLDING_REGISTERS_EXAMPLE)).toEqual({
    kind: "registers",
    registers: READ_HOLDING_REGISTERS_VALUES,
  });
  expect(decodeReadResponse(READ_INPUT_REGISTERS_EXAMPLE.responsePdu, READ_INPUT_REGISTERS_EXAMPLE)).toEqual({
    kind: "registers",
    registers: READ_INPUT_REGISTERS_VALUES,
  });
}

export function assertTheExceptionReplyDecodesToItsCode(): void {
  expect(decodeReadResponse(EXCEPTION_EXAMPLE.responsePdu, EXCEPTION_EXAMPLE)).toEqual({
    kind: "exception",
    exceptionCode: EXCEPTION_EXAMPLE.exceptionCode,
  });
}

export function assertAWrongByteCountIsAnError(): void {
  // The document's FC 03 reply with its byte count changed from 06 to 04.
  const pdu = Uint8Array.from(READ_HOLDING_REGISTERS_EXAMPLE.responsePdu);
  pdu[1] = 0x04;
  expect(reasonOf(() => decodeReadResponse(pdu, READ_HOLDING_REGISTERS_EXAMPLE))).toBe("byte-count-mismatch");
  // A byte count that matches the frame but not the request (2 of 3 registers asked).
  const twoRegisters = Uint8Array.from([0x03, 0x04, 0x02, 0x2b, 0x00, 0x00]);
  expect(reasonOf(() => decodeReadResponse(twoRegisters, READ_HOLDING_REGISTERS_EXAMPLE))).toBe(
    "byte-count-mismatch",
  );
  // FC 01, 19 coils need 3 bytes, not 2.
  const shortBits = Uint8Array.from([0x01, 0x02, 0xcd, 0x6b]);
  expect(reasonOf(() => decodeReadResponse(shortBits, READ_COILS_EXAMPLE))).toBe("byte-count-mismatch");
}

export function assertDataBytesThatDisagreeWithTheByteCountAreAnError(): void {
  // The document's FC 01 reply cut after its first data byte: the byte count
  // (03) is right, the data is not.
  const truncatedBits = Uint8Array.from([0x01, 0x03, 0xcd]);
  expect(reasonOf(() => decodeReadResponse(truncatedBits, READ_COILS_EXAMPLE))).toBe("length-mismatch");
  // The document's FC 03 reply with one byte too many, and one too few.
  const extra = Uint8Array.from([...READ_HOLDING_REGISTERS_EXAMPLE.responsePdu, 0x00]);
  expect(reasonOf(() => decodeReadResponse(extra, READ_HOLDING_REGISTERS_EXAMPLE))).toBe("length-mismatch");
  const short = Uint8Array.from([0x03, 0x06, 0x02, 0x2b]);
  expect(reasonOf(() => decodeReadResponse(short, READ_HOLDING_REGISTERS_EXAMPLE))).toBe("length-mismatch");
}

export function assertAWrongFunctionCodeIsAnError(): void {
  // The document's FC 04 reply, answered to an FC 03 request.
  expect(
    reasonOf(() => decodeReadResponse(READ_INPUT_REGISTERS_EXAMPLE.responsePdu, { functionCode: 3, quantity: 1 })),
  ).toBe("function-mismatch");
  // An exception for another function code.
  expect(reasonOf(() => decodeReadResponse(Uint8Array.from([0x83, 0x02]), READ_COILS_EXAMPLE))).toBe(
    "function-mismatch",
  );
}

export function assertAShortFrameIsAnError(): void {
  expect(reasonOf(() => decodeReadResponse(new Uint8Array(0), READ_COILS_EXAMPLE))).toBe("short-frame");
  expect(reasonOf(() => decodeReadResponse(Uint8Array.from([0x03]), READ_HOLDING_REGISTERS_EXAMPLE))).toBe(
    "short-frame",
  );
  expect(reasonOf(() => decodeReadResponse(Uint8Array.from([0x81]), EXCEPTION_EXAMPLE))).toBe("short-frame");
  expect(reasonOf(() => decodeReadResponse(Uint8Array.from([0x81, 0x02, 0x00]), EXCEPTION_EXAMPLE))).toBe(
    "length-mismatch",
  );
  // An ADU shorter than its header, one whose length field disagrees, and a non-zero protocol id.
  expect(reasonOf(() => decodeAdu(GUIDE_REQUEST_ADU.adu.subarray(0, 6)))).toBe("short-frame");
  expect(reasonOf(() => decodeAdu(GUIDE_REQUEST_ADU.adu.subarray(0, 11)))).toBe("length-mismatch");
  const otherProtocol = Uint8Array.from(GUIDE_REQUEST_ADU.adu);
  otherProtocol[3] = 0x01;
  expect(reasonOf(() => decodeAdu(otherProtocol))).toBe("bad-protocol-id");
}

export function assertAnAduLengthOutside2To254IsAnError(): void {
  // A 261-byte frame whose length field (255) describes it exactly.
  const tooLong = new Uint8Array(261);
  tooLong[5] = 0xff;
  expect(reasonOf(() => decodeAdu(tooLong))).toBe("length-out-of-range");
  // An 8-byte frame (header and a unit id) whose length field says 1.
  expect(reasonOf(() => decodeAdu(Uint8Array.from([0, 1, 0, 0, 0, 1, 0xff, 0x03])))).toBe("length-out-of-range");
}

// ---- T1.3: values ----------------------------------------------------------

export function assertEveryTypeDecodesInEveryLayout(): void {
  for (const example of VALUE_LAYOUT_EXAMPLES) {
    const layouts = [
      ["big", false, example.big],
      ["little", false, example.little],
      ["big", true, example.bigSwapped],
      ["little", true, example.littleSwapped],
    ] as const;
    for (const [wordOrder, byteSwap, words] of layouts) {
      const decoded = decodeRegisterValue(words, { type: example.type, wordOrder, byteSwap });
      const label = `${example.type} ${wordOrder}${byteSwap ? " swapped" : ""}`;
      if (example.type === "float32") {
        expect(decoded.value, label).toBeCloseTo(example.value, 4);
      } else {
        expect(decoded.value, label).toBe(example.value);
      }
      expect(decoded.inRange, label).toBe(true);
    }
  }
}

export function assertABoolRegisterOfZeroIsFalse(): void {
  expect(decodeRegisterValue([0x0000], { type: "bool", wordOrder: "big", byteSwap: false })).toEqual({
    value: 0,
    inRange: true,
  });
}

export function assertOutOfRangeValuesAreReportedNotRounded(): void {
  const big = { wordOrder: "big", byteSwap: false } as const;
  for (const [type, words] of [
    ["uint64", OUT_OF_RANGE_WORDS.uint64PastSafe],
    ["int64", OUT_OF_RANGE_WORDS.int64PastSafe],
    ["float32", OUT_OF_RANGE_WORDS.float32NaN],
    ["float64", OUT_OF_RANGE_WORDS.float64Infinity],
  ] as const) {
    expect(decodeRegisterValue(words, { type, ...big }), type).toEqual({ value: 0, inRange: false });
  }
  // Both ends of the safe range are in range: -(2^53 - 1) = FF E0 00 00 00 00 00 01.
  expect(decodeRegisterValue([0xffe0, 0x0000, 0x0000, 0x0001], { type: "int64", ...big })).toEqual({
    value: -9_007_199_254_740_991,
    inRange: true,
  });
}

export function assertTooFewWordsIsAnError(): void {
  expect(() => decodeRegisterValue([0x1234], { type: "uint32", wordOrder: "big", byteSwap: false })).toThrow(
    RangeError,
  );
}

export function assertAWordOutsideSixteenBitsIsAnError(): void {
  for (const word of [0x1_2345, -1, 1.5]) {
    expect(() => decodeRegisterValue([word], { type: "uint16", wordOrder: "big", byteSwap: false }), String(word)).toThrow(
      RangeError,
    );
  }
}

// ---- T1.3: the frame assembler ---------------------------------------------

export function assertTheAssemblerSplitsTwoFramesFromOneChunk(): void {
  const assembler = createMbapFrameAssembler();
  const second = handAdu(0x0002, 0x01, READ_INPUT_REGISTERS_EXAMPLE.responsePdu);
  const frames = assembler.push(Uint8Array.from([...GUIDE_REQUEST_ADU.adu, ...second]));
  expect(frames.map(hex)).toEqual([hex(GUIDE_REQUEST_ADU.adu), hex(second)]);
  expect(assembler.pendingBytes()).toBe(0);
}

export function assertTheAssemblerJoinsOneFrameFromThreeChunks(): void {
  const assembler = createMbapFrameAssembler();
  const adu = GUIDE_REQUEST_ADU.adu;
  expect(assembler.push(adu.subarray(0, 3))).toEqual([]);
  expect(assembler.push(adu.subarray(3, 8))).toEqual([]);
  expect(assembler.pendingBytes()).toBe(8);
  const frames = assembler.push(adu.subarray(8));
  expect(frames.map(hex)).toEqual([hex(adu)]);
  expect(assembler.pendingBytes()).toBe(0);
}

export function assertTheAssemblerRefusesALengthOf255(): void {
  expect(MODBUS_MAX_LENGTH_FIELD).toBe(254);
  const header = (length: number) => Uint8Array.from([0x00, 0x01, 0x00, 0x00, length >> 8, length & 0xff]);
  expect(reasonOf(() => createMbapFrameAssembler().push(header(255)))).toBe("length-out-of-range");
  expect(reasonOf(() => createMbapFrameAssembler().push(header(1)))).toBe("length-out-of-range");
  expect(reasonOf(() => createMbapFrameAssembler().push(header(254)))).toBe("no error");
}

export function assertTheAssemblerRefusesAnotherProtocol(): void {
  expect(
    reasonOf(() => createMbapFrameAssembler().push(Uint8Array.from([0x00, 0x01, 0x00, 0x01, 0x00, 0x06]))),
  ).toBe("bad-protocol-id");
}

// ---- T1.4: the server half -------------------------------------------------

/** An image holding exactly what the document's examples read. */
const documentImage = (): ModbusImage => {
  const coil = new Map<number, boolean>();
  READ_COILS_STATES.forEach((state, i) => coil.set(READ_COILS_EXAMPLE.address + i, state));
  const discrete = new Map<number, boolean>();
  READ_DISCRETE_INPUTS_STATES.forEach((state, i) => discrete.set(READ_DISCRETE_INPUTS_EXAMPLE.address + i, state));
  const holding = new Map<number, number>();
  READ_HOLDING_REGISTERS_VALUES.forEach((value, i) => holding.set(READ_HOLDING_REGISTERS_EXAMPLE.address + i, value));
  const input = new Map<number, number>([[READ_INPUT_REGISTERS_EXAMPLE.address, READ_INPUT_REGISTERS_VALUES[0] as number]]);
  return { coil, discrete, holding, input };
};

export function assertTheServerAnswersEachDocumentRequestWithItsReply(): void {
  const image = documentImage();
  READ_EXAMPLES.forEach((example, i) => {
    const request = handAdu(0x0100 + i, 0x11, example.requestPdu);
    const reply = serveModbusFrame(request, image);
    expect(hex(reply), example.source).toBe(hex(handAdu(0x0100 + i, 0x11, example.responsePdu)));
  });
  // The guide's ADU, unit 0xFF, served from a holding register at address 4.
  const reply = serveModbusFrame(GUIDE_REQUEST_ADU.adu, { holding: new Map([[4, 0x00aa]]) });
  expect(hex(reply)).toBe("150100000005ff030200aa");
}

export function assertTheServerAnswersAnyOtherFunctionWithException01(): void {
  // FC 06 Write Single Register, [APP] §6.6's own example request: 06 00 01 00 03.
  const writeRegister = handAdu(0x0007, 0x01, Uint8Array.from([0x06, 0x00, 0x01, 0x00, 0x03]));
  expect(hex(serveModbusFrame(writeRegister, documentImage()))).toBe(hex(handAdu(0x0007, 0x01, Uint8Array.from([0x86, 0x01]))));
  const writeCoil = handAdu(0x0008, 0x01, Uint8Array.from([0x05, 0x00, 0xac, 0xff, 0x00]));
  expect(hex(serveModbusFrame(writeCoil, documentImage()))).toBe(hex(handAdu(0x0008, 0x01, Uint8Array.from([0x85, 0x01]))));
}

export function assertTheServerAnswersAnAddressOutsideTheImageWithException02(): void {
  // The document's own exception example: output 1185 does not exist.
  const request = handAdu(0x0009, 0x01, EXCEPTION_EXAMPLE.requestPdu);
  expect(hex(serveModbusFrame(request, documentImage()))).toBe(hex(handAdu(0x0009, 0x01, EXCEPTION_EXAMPLE.responsePdu)));
  // A range that starts inside the image and runs past it.
  const pastEnd = handAdu(0x000a, 0x01, Uint8Array.from([0x03, 0x00, 0x6b, 0x00, 0x04]));
  expect(hex(serveModbusFrame(pastEnd, documentImage()))).toBe(hex(handAdu(0x000a, 0x01, Uint8Array.from([0x83, 0x02]))));
}

export function assertTheServerAnswersABadQuantityWithException03(): void {
  const tooMany = handAdu(0x000b, 0x01, Uint8Array.from([0x03, 0x00, 0x00, 0x00, 0x7e]));
  expect(hex(serveModbusFrame(tooMany, documentImage()))).toBe(hex(handAdu(0x000b, 0x01, Uint8Array.from([0x83, 0x03]))));
  // [APP] §6.3's state diagram checks the quantity (03) before the address (02).
  const both = handAdu(0x000d, 0x01, Uint8Array.from([0x03, 0xff, 0xff, 0x00, 0x7e]));
  expect(hex(serveModbusFrame(both, documentImage()))).toBe(hex(handAdu(0x000d, 0x01, Uint8Array.from([0x83, 0x03]))));
  const truncated = handAdu(0x000c, 0x01, Uint8Array.from([0x04, 0x00, 0x08]));
  expect(hex(serveModbusFrame(truncated, documentImage()))).toBe(hex(handAdu(0x000c, 0x01, Uint8Array.from([0x84, 0x03]))));
}

export function assertTheServerDropsAFrameItCannotParse(): void {
  expect(serveModbusFrame(GUIDE_REQUEST_ADU.adu.subarray(0, 5), documentImage())).toBeNull();
}
