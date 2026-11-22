import {
  MODBUS_MAX_BITS_PER_READ,
  MODBUS_MAX_REGISTERS_PER_READ,
  MODBUS_TABLE_FUNCTION_CODE,
  MODBUS_TABLES,
  MODBUS_TYPE_WORDS,
  type ModbusRegister,
  type ModbusTable,
} from "@bms/shared/ingest";

/**
 * `F1.2` plan T4.1 / ADR 0141 decision 8 — the read plan: which requests one
 * poll sends for one device's registers. Pure: no I/O, no clock.
 *
 * Registers are grouped per table, sorted by address, and coalesced into a
 * block while each starts at or before the block's end + 1 (contiguous or
 * overlapping). A gap of one address or more starts a new block: gaps are not
 * bridged, because reading an unmapped address can raise an exception on a
 * real device. A block never exceeds 125 words (FC 3/4) or 2,000 bits
 * (FC 1/2); a register that would push it past the limit moves whole to the
 * next block.
 */

/** One register inside a block. `offset` counts words (FC 3/4) or bits (FC 1/2) from the block start. */
export type ModbusReadEntry = {
  readonly register: ModbusRegister;
  readonly offset: number;
};

/** One read request: a table, its function code, and a contiguous address range. */
export type ModbusReadBlock = {
  readonly table: ModbusTable;
  readonly functionCode: 1 | 2 | 3 | 4;
  readonly address: number;
  readonly quantity: number;
  readonly entries: readonly ModbusReadEntry[];
};

const isBitTable = (table: ModbusTable): boolean =>
  table === "coil" || table === "discrete";

/** Addresses a register spans: one bit on a bit table, its type's words on a word table. */
const spanOf = (register: ModbusRegister): number =>
  isBitTable(register.table) ? 1 : MODBUS_TYPE_WORDS[register.type];

const limitOf = (table: ModbusTable): number =>
  isBitTable(table) ? MODBUS_MAX_BITS_PER_READ : MODBUS_MAX_REGISTERS_PER_READ;

type OpenBlock = {
  address: number;
  end: number;
  entries: { register: ModbusRegister; address: number }[];
};

/**
 * The blocks to read for `registers`, keeping only those whose `sourceKey` is
 * in `sourceKeys` — an empty `sourceKeys` keeps every register (the edge
 * passes none; plan C5). Blocks come in table order coil, discrete, holding,
 * input, then by address; entries in address order, stable for equal addresses.
 */
export function planModbusReads(
  registers: readonly ModbusRegister[],
  sourceKeys: readonly string[],
): ModbusReadBlock[] {
  const wanted = sourceKeys.length === 0 ? null : new Set(sourceKeys);
  const selected =
    wanted === null
      ? registers
      : registers.filter((register) => wanted.has(register.sourceKey));

  const blocks: ModbusReadBlock[] = [];
  for (const table of MODBUS_TABLES) {
    const limit = limitOf(table);
    // Array.prototype.sort is stable, so equal addresses keep their input order.
    const sorted = selected
      .filter((register) => register.table === table)
      .sort((a, b) => a.address - b.address);

    const open: OpenBlock[] = [];
    for (const register of sorted) {
      const end = register.address + spanOf(register) - 1;
      const current = open[open.length - 1];
      if (current !== undefined && register.address <= current.end + 1) {
        const newEnd = Math.max(current.end, end);
        if (newEnd - current.address + 1 <= limit) {
          current.end = newEnd;
          current.entries.push({ register, address: register.address });
          continue;
        }
      }
      open.push({
        address: register.address,
        end,
        entries: [{ register, address: register.address }],
      });
    }

    for (const block of open) {
      blocks.push({
        table,
        functionCode: MODBUS_TABLE_FUNCTION_CODE[table],
        address: block.address,
        quantity: block.end - block.address + 1,
        entries: block.entries.map((entry) => ({
          register: entry.register,
          offset: entry.address - block.address,
        })),
      });
    }
  }
  return blocks;
}
