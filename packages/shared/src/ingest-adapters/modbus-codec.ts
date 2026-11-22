// Types only: this module is zod-free at runtime (plan C3), so the adapter, the
// in-process test server and the simulator can load it without the schemas.
import type { ModbusTable, ModbusValueType, ModbusWordOrder } from "../ingest-modbus";

/**
 * The Modbus TCP wire codec (ADR 0141 decisions 2, 4, 7; `F1.2` plan C3).
 *
 * Pure: `Uint8Array` and `DataView` only, no Node import and no zod, so the
 * ingest adapter (`apps/ingest`), its in-process test server and the
 * simulator (`apps/sim`) share one reading of the bytes. It covers:
 *
 * - the MBAP header (Messaging on TCP/IP Implementation Guide V1.0b §3.1.3);
 * - the read requests for function codes 01–04 **and no other**: the client
 *   half cannot encode a write (decision 2; `tests/f1.2-modbus-read-only.test.ts`);
 * - the read replies and the exception reply (Application Protocol V1.1b3
 *   §6.1–§6.4, §7);
 * - one register value from its words, in either word order, with or without
 *   a byte swap (decision 7);
 * - a frame assembler for a TCP byte stream;
 * - the server half, `serveModbusFrame`, which answers a read from an image
 *   and every other function code with exception 01.
 *
 * Fixtures with the documents' own bytes: `modbus-codec.fixtures.ts`.
 */

/** The four read function codes (App. Protocol §6.1–§6.4). Nothing else is encoded. */
export const MODBUS_READ_FUNCTION_CODES = [0x01, 0x02, 0x03, 0x04] as const;
export type ModbusReadFunctionCode = (typeof MODBUS_READ_FUNCTION_CODES)[number];

/** The function code that reads each table. */
export const MODBUS_TABLE_FUNCTION_CODE: Readonly<Record<ModbusTable, ModbusReadFunctionCode>> = {
  coil: 0x01,
  discrete: 0x02,
  holding: 0x03,
  input: 0x04,
};

const TABLE_OF_FUNCTION_CODE: Readonly<Record<ModbusReadFunctionCode, ModbusTable>> = {
  0x01: "coil",
  0x02: "discrete",
  0x03: "holding",
  0x04: "input",
};

/** The MBAP header is 7 bytes (Guide §3.1.3). */
export const MODBUS_MBAP_BYTES = 7;
/** The largest PDU (App. Protocol §4.1). */
export const MODBUS_MAX_PDU_BYTES = 253;
/** The largest MBAP length field: the unit id plus the largest PDU. */
export const MODBUS_MAX_LENGTH_FIELD = 1 + MODBUS_MAX_PDU_BYTES;
/** The smallest MBAP length field: the unit id plus a function code. */
const MODBUS_MIN_LENGTH_FIELD = 2;
/** Registers one FC 03/04 request may read (App. Protocol §6.3, §6.4). */
export const MODBUS_MAX_REGISTERS_PER_READ = 125;
/** Bits one FC 01/02 request may read (App. Protocol §6.1, §6.2). */
export const MODBUS_MAX_BITS_PER_READ = 2000;

/** The exception codes this codec's server half answers (App. Protocol §7). */
export const MODBUS_EXCEPTION_ILLEGAL_FUNCTION = 0x01;
export const MODBUS_EXCEPTION_ILLEGAL_DATA_ADDRESS = 0x02;
export const MODBUS_EXCEPTION_ILLEGAL_DATA_VALUE = 0x03;

const EXCEPTION_BIT = 0x80;
const READ_REQUEST_PDU_BYTES = 5;
const ADDRESS_SPACE = 0x1_0000;

/** Words each value type spans. */
export const MODBUS_TYPE_WORDS: Readonly<Record<ModbusValueType, 1 | 2 | 4>> = {
  bool: 1,
  int16: 1,
  uint16: 1,
  int32: 2,
  uint32: 2,
  int64: 4,
  uint64: 4,
  float32: 2,
  float64: 4,
};

export type ModbusProtocolErrorReason =
  | "short-frame"
  | "bad-protocol-id"
  | "length-mismatch"
  | "length-out-of-range"
  | "function-mismatch"
  | "byte-count-mismatch";

/**
 * A frame that is not a well-formed reply. Never a value: the caller treats
 * the read as failed. The message is the reason only and carries no bytes.
 */
export class ModbusProtocolError extends Error {
  constructor(readonly reason: ModbusProtocolErrorReason) {
    super(`malformed Modbus frame: ${reason}`);
    this.name = "ModbusProtocolError";
  }
}

const isReadFunctionCode = (code: number): code is ModbusReadFunctionCode =>
  (MODBUS_READ_FUNCTION_CODES as readonly number[]).includes(code);

const isBitFunctionCode = (code: ModbusReadFunctionCode): boolean =>
  code === MODBUS_TABLE_FUNCTION_CODE.coil || code === MODBUS_TABLE_FUNCTION_CODE.discrete;

const maxQuantity = (code: ModbusReadFunctionCode): number =>
  isBitFunctionCode(code) ? MODBUS_MAX_BITS_PER_READ : MODBUS_MAX_REGISTERS_PER_READ;

const isUint = (value: number, max: number): boolean => Number.isInteger(value) && value >= 0 && value <= max;

// ---- MBAP ------------------------------------------------------------------

export interface ModbusAdu {
  readonly transactionId: number;
  readonly unitId: number;
  readonly pdu: Uint8Array;
}

/**
 * Wraps a PDU in an MBAP header. Protocol id 0, big-endian fields (Guide §3.1.3).
 * Not exported: the client half frames only what `encodeReadRequestPdu` built,
 * and the server half its own replies, so no caller can frame a write PDU.
 */
function encodeAdu(adu: ModbusAdu): Uint8Array {
  if (!isUint(adu.transactionId, 0xffff)) throw new RangeError("transaction id must be 0 to 65535");
  if (!isUint(adu.unitId, 0xff)) throw new RangeError("unit id must be 0 to 255");
  if (adu.pdu.length < 1 || adu.pdu.length > MODBUS_MAX_PDU_BYTES) {
    throw new RangeError("a PDU is 1 to 253 bytes");
  }
  const frame = new Uint8Array(MODBUS_MBAP_BYTES + adu.pdu.length);
  const view = new DataView(frame.buffer);
  view.setUint16(0, adu.transactionId);
  view.setUint16(2, 0);
  view.setUint16(4, adu.pdu.length + 1);
  view.setUint8(6, adu.unitId);
  frame.set(adu.pdu, MODBUS_MBAP_BYTES);
  return frame;
}

/** Reads one whole ADU. Throws `ModbusProtocolError` when the header does not describe the frame. */
export function decodeAdu(frame: Uint8Array): ModbusAdu {
  if (frame.length < MODBUS_MBAP_BYTES + 1) throw new ModbusProtocolError("short-frame");
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  if (view.getUint16(2) !== 0) throw new ModbusProtocolError("bad-protocol-id");
  const length = view.getUint16(4);
  if (length < MODBUS_MIN_LENGTH_FIELD || length > MODBUS_MAX_LENGTH_FIELD) {
    throw new ModbusProtocolError("length-out-of-range");
  }
  if (length !== frame.length - (MODBUS_MBAP_BYTES - 1)) throw new ModbusProtocolError("length-mismatch");
  return {
    transactionId: view.getUint16(0),
    unitId: view.getUint8(6),
    pdu: frame.slice(MODBUS_MBAP_BYTES),
  };
}

// ---- Requests --------------------------------------------------------------

export interface ModbusReadRequest {
  readonly functionCode: ModbusReadFunctionCode;
  /** Zero-based start address. */
  readonly address: number;
  readonly quantity: number;
}

/**
 * The PDU of a read request: function code, start address, quantity.
 * Refuses any function code but 01–04, a quantity past the function's limit,
 * and a range that runs past address 65535.
 */
export function encodeReadRequestPdu(request: ModbusReadRequest): Uint8Array {
  const { functionCode, address, quantity } = request;
  if (!isReadFunctionCode(functionCode)) throw new RangeError("only function codes 1 to 4 are encoded");
  if (!isUint(address, ADDRESS_SPACE - 1)) throw new RangeError("address must be 0 to 65535");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity(functionCode)) {
    throw new RangeError("quantity is out of range for the function code");
  }
  if (address + quantity > ADDRESS_SPACE) throw new RangeError("the range runs past address 65535");
  const pdu = new Uint8Array(READ_REQUEST_PDU_BYTES);
  const view = new DataView(pdu.buffer);
  view.setUint8(0, functionCode);
  view.setUint16(1, address);
  view.setUint16(3, quantity);
  return pdu;
}

/** A whole read request ADU. */
export function encodeReadRequest(
  request: ModbusReadRequest & { readonly transactionId: number; readonly unitId: number },
): Uint8Array {
  return encodeAdu({
    transactionId: request.transactionId,
    unitId: request.unitId,
    pdu: encodeReadRequestPdu(request),
  });
}

// ---- Replies ---------------------------------------------------------------

export type ModbusReadReply =
  | { readonly kind: "registers"; readonly registers: number[] }
  | { readonly kind: "bits"; readonly bits: boolean[] }
  | { readonly kind: "exception"; readonly exceptionCode: number };

/**
 * Reads a reply PDU against the request it answers. An exception reply (high
 * bit set) is a value of its own; a reply whose function code, byte count or
 * length does not match the request throws `ModbusProtocolError`.
 */
export function decodeReadResponse(
  pdu: Uint8Array,
  request: Pick<ModbusReadRequest, "functionCode" | "quantity">,
): ModbusReadReply {
  if (pdu.length < 1) throw new ModbusProtocolError("short-frame");
  const code = pdu[0] as number;
  if ((code & EXCEPTION_BIT) !== 0) {
    if ((code & ~EXCEPTION_BIT) !== request.functionCode) throw new ModbusProtocolError("function-mismatch");
    if (pdu.length < 2) throw new ModbusProtocolError("short-frame");
    if (pdu.length !== 2) throw new ModbusProtocolError("length-mismatch");
    return { kind: "exception", exceptionCode: pdu[1] as number };
  }
  if (code !== request.functionCode) throw new ModbusProtocolError("function-mismatch");
  if (pdu.length < 2) throw new ModbusProtocolError("short-frame");
  const bits = isBitFunctionCode(request.functionCode);
  const expectedByteCount = bits ? Math.ceil(request.quantity / 8) : request.quantity * 2;
  const byteCount = pdu[1] as number;
  if (byteCount !== expectedByteCount) throw new ModbusProtocolError("byte-count-mismatch");
  if (pdu.length !== 2 + byteCount) throw new ModbusProtocolError("length-mismatch");
  if (bits) {
    // App. Protocol §6.1: the LSB of the first data byte is the first bit read.
    return {
      kind: "bits",
      bits: Array.from({ length: request.quantity }, (_, i) => (((pdu[2 + (i >> 3)] as number) >> (i & 7)) & 1) === 1),
    };
  }
  const view = new DataView(pdu.buffer, pdu.byteOffset + 2, byteCount);
  return { kind: "registers", registers: Array.from({ length: request.quantity }, (_, i) => view.getUint16(i * 2)) };
}

// ---- Values ----------------------------------------------------------------

export interface ModbusValueFormat {
  readonly type: ModbusValueType;
  /** `big`: the first word read is the most significant. */
  readonly wordOrder: ModbusWordOrder;
  /** Exchange the two bytes inside each word before reading. */
  readonly byteSwap: boolean;
}

/**
 * One value from its words (the first `MODBUS_TYPE_WORDS[type]` of `words`).
 * `bool` is true for any non-zero word. A 64-bit value outside
 * ±`Number.MAX_SAFE_INTEGER` and a non-finite float are `{ value: 0, inRange:
 * false }`: the adapter emits them with `good: false`, never rounded
 * (decision 7, Amendment 1 (b)). Scale and offset are the adapter's.
 */
export function decodeRegisterValue(
  words: readonly number[],
  format: ModbusValueFormat,
): { value: number; inRange: boolean } {
  const count = MODBUS_TYPE_WORDS[format.type];
  if (words.length < count) throw new RangeError("too few words for the value type");
  const ordered = words.slice(0, count);
  if (!ordered.every((word) => isUint(word, 0xffff))) throw new RangeError("a register word is 0 to 65535");
  if (format.type === "bool") return { value: ordered[0] === 0 ? 0 : 1, inRange: true };
  if (format.wordOrder === "little") ordered.reverse();
  const bytes = new Uint8Array(count * 2);
  ordered.forEach((word, i) => {
    const high = (word >> 8) & 0xff;
    const low = word & 0xff;
    bytes[i * 2] = format.byteSwap ? low : high;
    bytes[i * 2 + 1] = format.byteSwap ? high : low;
  });
  const view = new DataView(bytes.buffer);
  const value = readValue(view, format.type);
  return Number.isFinite(value) ? { value, inRange: true } : { value: 0, inRange: false };
}

/** Reads a big-endian value; `NaN` stands for "no safe number". */
function readValue(view: DataView, type: Exclude<ModbusValueType, "bool">): number {
  switch (type) {
    case "int16":
      return view.getInt16(0);
    case "uint16":
      return view.getUint16(0);
    case "int32":
      return view.getInt32(0);
    case "uint32":
      return view.getUint32(0);
    case "int64":
      return safe(view.getBigInt64(0));
    case "uint64":
      return safe(view.getBigUint64(0));
    case "float32":
      return view.getFloat32(0);
    case "float64":
      return view.getFloat64(0);
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const safe = (raw: bigint): number => (raw > MAX_SAFE || raw < -MAX_SAFE ? Number.NaN : Number(raw));

// ---- The stream ------------------------------------------------------------

export interface MbapFrameAssembler {
  /** Adds bytes from the socket and returns every frame they complete, in order. */
  push(chunk: Uint8Array): Uint8Array[];
  /** Bytes held for an incomplete frame: never more than one frame's worth. */
  pendingBytes(): number;
}

/**
 * Splits a TCP byte stream into ADUs by the MBAP length field. A non-zero
 * protocol id, or a length field outside 2–254, throws `ModbusProtocolError`:
 * the stream cannot be resynchronised and the caller closes the socket. The
 * throw also discards any whole frame earlier in the same chunk: those reads
 * are then reported failed with the rest. At most one partial frame (under
 * 261 bytes) is ever held.
 */
export function createMbapFrameAssembler(): MbapFrameAssembler {
  let pending: Uint8Array = new Uint8Array(0);
  return {
    push(chunk) {
      const joined = new Uint8Array(pending.length + chunk.length);
      joined.set(pending, 0);
      joined.set(chunk, pending.length);
      const frames: Uint8Array[] = [];
      let start = 0;
      for (;;) {
        const available = joined.length - start;
        if (available >= 4 && (joined[start + 2] !== 0 || joined[start + 3] !== 0)) {
          throw new ModbusProtocolError("bad-protocol-id");
        }
        if (available < MODBUS_MBAP_BYTES - 1) break;
        const length = ((joined[start + 4] as number) << 8) | (joined[start + 5] as number);
        if (length < MODBUS_MIN_LENGTH_FIELD || length > MODBUS_MAX_LENGTH_FIELD) {
          throw new ModbusProtocolError("length-out-of-range");
        }
        const total = MODBUS_MBAP_BYTES - 1 + length;
        if (available < total) break;
        frames.push(joined.slice(start, start + total));
        start += total;
      }
      pending = joined.slice(start);
      return frames;
    },
    pendingBytes() {
      return pending.length;
    },
  };
}

// ---- The server half -------------------------------------------------------

/** What a server holds, by table and zero-based address. An absent address does not exist. */
export interface ModbusImage {
  readonly coil?: ReadonlyMap<number, boolean>;
  readonly discrete?: ReadonlyMap<number, boolean>;
  readonly holding?: ReadonlyMap<number, number>;
  readonly input?: ReadonlyMap<number, number>;
}

/**
 * Answers one request ADU from an image, for the in-process test server and
 * the simulator. Function codes 01–04 read the image; any other function code
 * gets exception 01, an address the image lacks exception 02, a bad quantity
 * or a malformed read PDU exception 03. A frame whose header cannot be read
 * gets no answer (`null`).
 */
export function serveModbusFrame(frame: Uint8Array, image: ModbusImage): Uint8Array | null {
  let request: ModbusAdu;
  try {
    request = decodeAdu(frame);
  } catch {
    return null;
  }
  const reply = (pdu: Uint8Array) => encodeAdu({ transactionId: request.transactionId, unitId: request.unitId, pdu });
  const code = request.pdu[0] as number;
  const exception = (exceptionCode: number) => reply(Uint8Array.from([(code | EXCEPTION_BIT) & 0xff, exceptionCode]));

  if (!isReadFunctionCode(code)) return exception(MODBUS_EXCEPTION_ILLEGAL_FUNCTION);
  if (request.pdu.length !== READ_REQUEST_PDU_BYTES) return exception(MODBUS_EXCEPTION_ILLEGAL_DATA_VALUE);
  const view = new DataView(request.pdu.buffer, request.pdu.byteOffset, request.pdu.byteLength);
  const address = view.getUint16(1);
  const quantity = view.getUint16(3);
  if (quantity < 1 || quantity > maxQuantity(code)) return exception(MODBUS_EXCEPTION_ILLEGAL_DATA_VALUE);
  if (address + quantity > ADDRESS_SPACE) return exception(MODBUS_EXCEPTION_ILLEGAL_DATA_ADDRESS);

  const table = TABLE_OF_FUNCTION_CODE[code];
  if (isBitFunctionCode(code)) {
    const states = (table === "coil" ? image.coil : image.discrete) ?? new Map<number, boolean>();
    const data = new Uint8Array(Math.ceil(quantity / 8));
    for (let i = 0; i < quantity; i += 1) {
      const state = states.get(address + i);
      if (state === undefined) return exception(MODBUS_EXCEPTION_ILLEGAL_DATA_ADDRESS);
      if (state) data[i >> 3] = (data[i >> 3] as number) | (1 << (i & 7));
    }
    return reply(Uint8Array.from([code, data.length, ...data]));
  }
  const words = (table === "holding" ? image.holding : image.input) ?? new Map<number, number>();
  const pdu = new Uint8Array(2 + quantity * 2);
  const out = new DataView(pdu.buffer);
  out.setUint8(0, code);
  out.setUint8(1, quantity * 2);
  for (let i = 0; i < quantity; i += 1) {
    const word = words.get(address + i);
    if (word === undefined) return exception(MODBUS_EXCEPTION_ILLEGAL_DATA_ADDRESS);
    out.setUint16(2 + i * 2, word & 0xffff);
  }
  return reply(pdu);
}
