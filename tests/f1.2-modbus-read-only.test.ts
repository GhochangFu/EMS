import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F1.2` / ADR 0141 decision 2 — the Modbus client is read only.
 *
 * The adapter sends function codes 01–04 and nothing else; writing to a device
 * is the command path (`F3.12`) and needs its own ADR. The codec's own spec
 * proves `encodeReadRequestPdu` refuses 5, 6, 15 and 16 at runtime; this file
 * proves no source file under the scan can *name* one as a request code, so a
 * write builder cannot be added beside the read path unnoticed.
 *
 * It also holds plan M16: everything reachable from `@bms/shared/ingest` loads
 * in the web bundle, so the codec and the schemas import nothing from Node.
 *
 * Plan PR 4 adds the three adapter files (`apps/ingest/src/adapters/modbus-*`)
 * to `READ_ONLY_SCAN` by name. Inline assertions are the `tests/` carve-out in
 * AGENTS.md §4.6.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(repoRoot, relative), "utf8");

/** Every file that builds or sends a Modbus request. Asserted by name, not by count. */
const READ_ONLY_SCAN = ["packages/shared/src/ingest-adapters/modbus-codec.ts"] as const;

/** The files reachable from `./ingest` that this row adds. */
const NODE_FREE = [
  "packages/shared/src/ingest-adapters/modbus-codec.ts",
  "packages/shared/src/ingest-modbus.ts",
  "packages/shared/src/ingest-poll-interval.ts",
  "packages/shared/src/ingest-adapters/modbus-tcp-hosts.ts",
] as const;

/**
 * Removes `//` and `/* *\/` comments outside string literals, keeping
 * newlines, so a docblock that names a write function code cannot trip the
 * scan and a comment cannot hide a real literal from it.
 */
function stripComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 1;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * The write function codes, in each spelling a request builder would use:
 * a hex byte (`0x05`, `0x0F`, `0x10`, any leading zeros); a decimal assigned
 * to or compared with something named like a function code, or as a `case`;
 * or a decimal written as the first byte of a PDU (`setUint8(0, 6)`,
 * `Uint8Array.of(6, …)`, `Uint8Array.from([6, …])`, `[6, 0, 1, 0, 3]`).
 */
const WRITE_CODE_HEX = /\b0x0*(?:5|6|f|10)\b/i;
const WRITE_CODE_NAMED =
  /(?:\b(?:functionCode|function_code|fc|code)\b\s*(?:[:=]|===|!==|==)|\bcase)\s*(?:5|6|15|16)\b/i;
const WRITE_CODE_FIRST_BYTE =
  /(?:\bsetUint8\(\s*0\s*,|\bUint8Array\.of\(|\bUint8Array\.from\(\s*\[|(?:=|\(|,|:)\s*\[)\s*(?:5|6|15|16)\s*[,)\]]/;
const namesAWriteCode = (line: string) =>
  WRITE_CODE_HEX.test(line) || WRITE_CODE_NAMED.test(line) || WRITE_CODE_FIRST_BYTE.test(line);

describe("F1.2 — the Modbus client is read only (ADR 0141 decision 2)", () => {
  it("scans exactly the files that build Modbus requests, and each exists", () => {
    expect([...READ_ONLY_SCAN]).toEqual(["packages/shared/src/ingest-adapters/modbus-codec.ts"]);
    for (const file of READ_ONLY_SCAN) {
      expect(existsSync(join(repoRoot, file)), `${file} is in the scan but does not exist`).toBe(true);
    }
  });

  it("the request encoder names function codes 1 to 4 and nothing else", () => {
    const codec = stripComments(read("packages/shared/src/ingest-adapters/modbus-codec.ts"));
    expect(codec).toMatch(/export const MODBUS_READ_FUNCTION_CODES = \[0x01, 0x02, 0x03, 0x04\] as const;/);
    // The encoder refuses anything outside that list before it writes a byte.
    const encoder = codec.slice(codec.indexOf("export function encodeReadRequestPdu"));
    expect(encoder.indexOf("if (!isReadFunctionCode(functionCode)) throw"), "the encoder no longer gates on the read list").toBeGreaterThan(-1);
  });

  it("no scanned file names 5, 6, 15 or 16 as a request code", () => {
    for (const file of READ_ONLY_SCAN) {
      const lines = stripComments(read(file)).split("\n");
      const offending = lines
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => namesAWriteCode(line))
        .map(({ number, line }) => `${file}:${number}: ${line.trim()}`);
      expect(offending, "a Modbus write function code appears in the read-only client").toEqual([]);
    }
  });

  it("the scan's patterns catch each spelling of a write code", () => {
    // Anti-vacuity: the two patterns above must match what they claim to.
    for (const line of [
      "pdu[0] = 0x06;",
      "view.setUint8(0, 0x0F);",
      "const WRITE = 0x10;",
      "x = 0x05",
      "functionCode: 6,",
      "if (fc === 16)",
      "functionCode = 15",
      "code: 6,",
      "case 6:",
      "view.setUint8(0, 6);",
      "pdu: Uint8Array.of(6, 0, 1, 0, 3)",
      "Uint8Array.from([16, 0, 1])",
      "const pdu = [5, 0, 172, 255, 0];",
    ]) {
      expect(namesAWriteCode(line), line).toBe(true);
    }
    for (const line of [
      "0x01, 0x02, 0x03, 0x04",
      "0x80",
      "0x7f",
      "functionCode: 3",
      "0xff",
      "view.setUint8(6, adu.unitId);",
      "bytes[i * 2 + 1] = 16;",
      "Uint8Array.from([code, data.length, ...data])",
    ]) {
      expect(namesAWriteCode(line), line).toBe(false);
    }
  });

  it("the codec exports no function that frames an arbitrary PDU", () => {
    // `encodeAdu` would let a caller wrap any PDU, a write included. The
    // client half frames only `encodeReadRequestPdu`'s output.
    const codec = stripComments(read("packages/shared/src/ingest-adapters/modbus-codec.ts"));
    expect(codec).toMatch(/\nfunction encodeAdu\(/);
    expect(codec).not.toMatch(/export\s+(?:function\s+encodeAdu\b|\{[^}]*\bencodeAdu\b)/);
  });

  it("the codec and the Modbus schemas import nothing from Node, and the codec nothing at runtime", () => {
    const nodeImport = /(?:from\s+["']|require\(\s*["']|import\(\s*["'])(?:node:|(?:net|fs|buffer|os|path|crypto|stream|events|tls|dgram|child_process)["'/])/;
    for (const file of NODE_FREE) {
      const source = stripComments(read(file));
      expect(nodeImport.test(source), `${file} imports a Node module`).toBe(false);
      expect(/\bBuffer\b/.test(source), `${file} uses Node's Buffer`).toBe(false);
    }
    // The codec is zod-free: its only import is `import type`, erased at emit.
    const codecImports = stripComments(read("packages/shared/src/ingest-adapters/modbus-codec.ts"))
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line));
    expect(codecImports.length, "the codec's import lines were not found; this check is vacuous").toBeGreaterThan(0);
    for (const line of codecImports) {
      expect(line, "the codec has a runtime import").toMatch(/^\s*import type\b/);
    }
  });
});
