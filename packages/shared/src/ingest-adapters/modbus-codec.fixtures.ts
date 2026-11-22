/**
 * Golden fixtures for the Modbus codec (`F1.2` plan T1.0, T1.3, T1.4).
 *
 * Every frame below is copied from one of two documents, byte for byte, with
 * the section it comes from. The codec spec encodes and decodes against these
 * bytes; nothing here is produced by the codec, so no case is a round trip.
 *
 * - **[APP]** MODBUS Application Protocol Specification V1.1b3, April 26, 2012,
 *   modbus.org. Its examples are PDUs (function code onwards).
 * - **[GUIDE]** MODBUS Messaging on TCP/IP Implementation Guide V1.0b,
 *   October 24, 2006, modbus.org. Its example is a whole ADU (MBAP header and
 *   PDU).
 *
 * **Unit identifier 255 (plan P1, ADR 0141 Amendment 1 (a)).** [GUIDE] §4.4.1.2
 * ("Build a MODBUS Request", page 23): "On TCP/IP, the MODBUS server is
 * addressed using its IP address; therefore, the MODBUS Unit Identifier is
 * useless. The value 0xFF has to be used." and "0xFF is recommended for the
 * 'Unit Identifier' as non-significant value." followed by "Remark: The value 0
 * is also accepted to communicate directly to a MODBUS/TCP device." The same
 * section gives serial addresses as 1 to 247, with 0 the broadcast address.
 * §4.4.1.3 (page 24) repeats it for the response: a directly connected device's
 * unit identifier "is not significant (value 0xFF)". So the guide confirms 255;
 * 248–254 appear nowhere in it as usable.
 *
 * **Frame bounds.** [APP] §4.1 (page 5): the PDU is at most 253 bytes, and
 * "TCP MODBUS ADU = 253 bytes + MBAP (7 bytes) = 260 bytes". [GUIDE] §3.1.3
 * (page 5): the MBAP header is 7 bytes; the length field "is a byte count of
 * the following fields, including the Unit Identifier and data fields". So the
 * largest valid length field is 1 + 253 = 254.
 *
 * **Transaction pairing.** [GUIDE] §4.4.1.3: "If the Transaction Identifier
 * doesn't refer to any MODBUS pending transaction, the response must be
 * discarded." (The transport in `apps/ingest` applies it; PR 4.)
 */

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

export interface ReadExample {
  /** Where the example is printed. */
  readonly source: string;
  readonly functionCode: 1 | 2 | 3 | 4;
  readonly address: number;
  readonly quantity: number;
  readonly requestPdu: Uint8Array;
  readonly responsePdu: Uint8Array;
}

/**
 * [APP] §6.1 "01 (0x01) Read Coils", page 12: "a request to read discrete
 * outputs 20–38". Outputs are numbered from 1, so the start address is 19
 * (0x13) and the quantity 19 (0x13). Response bytes CD 6B 05.
 */
export const READ_COILS_EXAMPLE: ReadExample = {
  source: "[APP] §6.1, page 12",
  functionCode: 1,
  address: 0x13,
  quantity: 0x13,
  requestPdu: bytes(0x01, 0x00, 0x13, 0x00, 0x13),
  responsePdu: bytes(0x01, 0x03, 0xcd, 0x6b, 0x05),
};

/**
 * The 19 coil states of `READ_COILS_EXAMPLE`, outputs 20 to 38 in order, read
 * off the document's binary: CD = 1100 1101 ("output 20 is the LSB"),
 * 6B = 0110 1011, 05 = 0000 0101 (outputs 38–36; the five high bits are
 * zero-filled).
 */
export const READ_COILS_STATES: readonly boolean[] = [
  // CD: outputs 20..27, LSB first
  true, false, true, true, false, false, true, true,
  // 6B: outputs 28..35
  true, true, false, true, false, true, true, false,
  // 05: outputs 36..38
  true, false, true,
];

/**
 * [APP] §6.2 "02 (0x02) Read Discrete Inputs", page 13: "a request to read
 * discrete inputs 197 – 218": start 0x00C4 (196), quantity 0x16 (22).
 * Response bytes AC DB 35.
 */
export const READ_DISCRETE_INPUTS_EXAMPLE: ReadExample = {
  source: "[APP] §6.2, page 13",
  functionCode: 2,
  address: 0xc4,
  quantity: 0x16,
  requestPdu: bytes(0x02, 0x00, 0xc4, 0x00, 0x16),
  responsePdu: bytes(0x02, 0x03, 0xac, 0xdb, 0x35),
};

/**
 * The 22 input states, inputs 197 to 218: AC = 1010 1100 ("input 197 is the
 * LSB"), DB = 1101 1011, 35 = 0011 0101 (inputs 218–213; two high bits zero).
 */
export const READ_DISCRETE_INPUTS_STATES: readonly boolean[] = [
  // AC: inputs 197..204
  false, false, true, true, false, true, false, true,
  // DB: inputs 205..212
  true, true, false, true, true, false, true, true,
  // 35: inputs 213..218
  true, false, true, false, true, true,
];

/**
 * [APP] §6.3 "03 (0x03) Read Holding Registers", page 15: "a request to read
 * registers 108 – 110": start 0x006B (107), quantity 3. "The contents of
 * register 108 are shown as the two byte values of 02 2B hex, or 555 decimal.
 * The contents of registers 109–110 are 00 00 and 00 64 hex, or 0 and 100".
 */
export const READ_HOLDING_REGISTERS_EXAMPLE: ReadExample = {
  source: "[APP] §6.3, page 15",
  functionCode: 3,
  address: 0x6b,
  quantity: 3,
  requestPdu: bytes(0x03, 0x00, 0x6b, 0x00, 0x03),
  responsePdu: bytes(0x03, 0x06, 0x02, 0x2b, 0x00, 0x00, 0x00, 0x64),
};
export const READ_HOLDING_REGISTERS_VALUES: readonly number[] = [555, 0, 100];

/**
 * [APP] §6.4 "04 (0x04) Read Input Registers", pages 16–17: "a request to
 * read input register 9": start 0x0008, quantity 1. "The contents of input
 * register 9 are shown as the two byte values of 00 0A hex, or 10 decimal."
 */
export const READ_INPUT_REGISTERS_EXAMPLE: ReadExample = {
  source: "[APP] §6.4, pages 16-17",
  functionCode: 4,
  address: 0x08,
  quantity: 1,
  requestPdu: bytes(0x04, 0x00, 0x08, 0x00, 0x01),
  responsePdu: bytes(0x04, 0x02, 0x00, 0x0a),
};
export const READ_INPUT_REGISTERS_VALUES: readonly number[] = [10];

export const READ_EXAMPLES: readonly ReadExample[] = [
  READ_COILS_EXAMPLE,
  READ_DISCRETE_INPUTS_EXAMPLE,
  READ_HOLDING_REGISTERS_EXAMPLE,
  READ_INPUT_REGISTERS_EXAMPLE,
];

/**
 * [APP] §7 "MODBUS Exception Responses", page 47, "Example of a client request
 * and server exception response": Read Coils at address 1185 (0x04A1),
 * quantity 1; the output does not exist, so the reply is function 0x81 with
 * exception code 02, ILLEGAL DATA ADDRESS.
 */
export const EXCEPTION_EXAMPLE = {
  source: "[APP] §7, page 47",
  functionCode: 1 as const,
  address: 0x04a1,
  quantity: 1,
  requestPdu: bytes(0x01, 0x04, 0xa1, 0x00, 0x01),
  responsePdu: bytes(0x81, 0x02),
  exceptionCode: 2,
};

/**
 * [GUIDE] §4.4.1.2 "Build a MODBUS Request", pages 22–23: "the MODBUS request
 * ADU encoding for reading the register # 5 in a remote server": transaction
 * 0x1501, protocol 0x0000, length 0x0006, unit identifier 0xFF, then function
 * 0x03, starting address 0x0004, quantity 0x0001.
 */
export const GUIDE_REQUEST_ADU = {
  source: "[GUIDE] §4.4.1.2, pages 22-23",
  transactionId: 0x1501,
  unitId: 0xff,
  functionCode: 3 as const,
  address: 0x0004,
  quantity: 0x0001,
  adu: bytes(0x15, 0x01, 0x00, 0x00, 0x00, 0x06, 0xff, 0x03, 0x00, 0x04, 0x00, 0x01),
};

/**
 * Hand-written words for the value decoder: one value per type, in each of
 * the four `wordOrder` × `byteSwap` layouts. The canonical big-endian bytes
 * were taken from Python's `struct.pack('>…')`, never from the codec, then
 * split into 16-bit words by hand:
 * - `big` + no swap: the bytes in order, two per word;
 * - `little`: the same words, last first;
 * - `byteSwap`: the two bytes inside each word exchanged.
 */
export interface ValueLayoutExample {
  readonly type: "bool" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "float32" | "float64";
  readonly value: number;
  readonly big: readonly number[];
  readonly little: readonly number[];
  readonly bigSwapped: readonly number[];
  readonly littleSwapped: readonly number[];
}

export const VALUE_LAYOUT_EXAMPLES: readonly ValueLayoutExample[] = [
  // bool on a register: non-zero is true. 0x0100 is non-zero in every layout.
  { type: "bool", value: 1, big: [0x0100], little: [0x0100], bigSwapped: [0x0100], littleSwapped: [0x0100] },
  // -12345 = CF C7
  { type: "int16", value: -12_345, big: [0xcfc7], little: [0xcfc7], bigSwapped: [0xc7cf], littleSwapped: [0xc7cf] },
  // 4660 = 12 34
  { type: "uint16", value: 4_660, big: [0x1234], little: [0x1234], bigSwapped: [0x3412], littleSwapped: [0x3412] },
  // -123456789 = F8 A4 32 EB
  {
    type: "int32",
    value: -123_456_789,
    big: [0xf8a4, 0x32eb],
    little: [0x32eb, 0xf8a4],
    bigSwapped: [0xa4f8, 0xeb32],
    littleSwapped: [0xeb32, 0xa4f8],
  },
  // 305419896 = 12 34 56 78
  {
    type: "uint32",
    value: 305_419_896,
    big: [0x1234, 0x5678],
    little: [0x5678, 0x1234],
    bigSwapped: [0x3412, 0x7856],
    littleSwapped: [0x7856, 0x3412],
  },
  // -1234567890123 = FF FF FE E0 8E 04 FB 35
  {
    type: "int64",
    value: -1_234_567_890_123,
    big: [0xffff, 0xfee0, 0x8e04, 0xfb35],
    little: [0xfb35, 0x8e04, 0xfee0, 0xffff],
    bigSwapped: [0xffff, 0xe0fe, 0x048e, 0x35fb],
    littleSwapped: [0x35fb, 0x048e, 0xe0fe, 0xffff],
  },
  // 9007199254740991 (Number.MAX_SAFE_INTEGER) = 00 1F FF FF FF FF FF FF
  {
    type: "uint64",
    value: 9_007_199_254_740_991,
    big: [0x001f, 0xffff, 0xffff, 0xffff],
    little: [0xffff, 0xffff, 0xffff, 0x001f],
    bigSwapped: [0x1f00, 0xffff, 0xffff, 0xffff],
    littleSwapped: [0xffff, 0xffff, 0xffff, 0x1f00],
  },
  // 230.5 = 43 66 80 00
  {
    type: "float32",
    value: 230.5,
    big: [0x4366, 0x8000],
    little: [0x8000, 0x4366],
    bigSwapped: [0x6643, 0x0080],
    littleSwapped: [0x0080, 0x6643],
  },
  // 1234.5678 = 40 93 4A 45 6D 5C FA AD
  {
    type: "float64",
    value: 1234.5678,
    big: [0x4093, 0x4a45, 0x6d5c, 0xfaad],
    little: [0xfaad, 0x6d5c, 0x4a45, 0x4093],
    bigSwapped: [0x9340, 0x454a, 0x5c6d, 0xadfa],
    littleSwapped: [0xadfa, 0x5c6d, 0x454a, 0x9340],
  },
];

/** Values a 64-bit or float register may hold that no `number` reading may carry (decision 7, Amendment 1 (b)). */
export const OUT_OF_RANGE_WORDS = {
  /** 9007199254740992 = MAX_SAFE_INTEGER + 1 = 00 20 00 00 00 00 00 00 */
  uint64PastSafe: [0x0020, 0x0000, 0x0000, 0x0000],
  /** -9007199254740992 = FF E0 00 00 00 00 00 00 */
  int64PastSafe: [0xffe0, 0x0000, 0x0000, 0x0000],
  /** float32 NaN = 7F C0 00 00 */
  float32NaN: [0x7fc0, 0x0000],
  /** float64 +Infinity = 7F F0 00 00 00 00 00 00 */
  float64Infinity: [0x7ff0, 0x0000, 0x0000, 0x0000],
} as const;
