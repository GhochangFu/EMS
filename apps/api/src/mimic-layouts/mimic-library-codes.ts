import { mimicSymbolLibraryCodeSchema } from "@bms/shared";
import type { MimicSymbolLibraryCode } from "@bms/shared";

/**
 * The library codes a response can carry: the contract enum (`F3.32f`, ADR 0086 decision 10).
 * Slice 3 unions the organization's `org.<code>` set per layout, so the caller passes the set
 * rather than this module reading the contract itself.
 */
export const KNOWN_LIBRARY_CODES: ReadonlySet<string> = new Set(mimicSymbolLibraryCodeSchema.options);

/**
 * Splits a stored `symbol_libraries` array into the codes `known` holds and the rest. Order and
 * duplicates are kept as stored; it never throws. The read path drops a code the response
 * contract cannot carry rather than fail the whole answer — the write path already refuses one.
 */
export function splitLibraryCodes(
  stored: readonly string[],
  known: ReadonlySet<string>,
): { kept: MimicSymbolLibraryCode[]; dropped: string[] } {
  const kept: MimicSymbolLibraryCode[] = [];
  const dropped: string[] = [];
  for (const code of stored) {
    if (known.has(code)) {
      kept.push(code as MimicSymbolLibraryCode);
    } else {
      dropped.push(code);
    }
  }
  return { kept, dropped };
}
