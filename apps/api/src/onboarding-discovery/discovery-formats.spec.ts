import { expect } from "vitest";

import { loadDiscoveryFormats, type DiscoveryFormatsReader } from "./discovery-formats";

/**
 * `F4.334` (plan T4.2) — the catalog read for discovery, with a fake reader
 * that returns rows in the order the query asks for. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */

const BUILTIN = { code: "thinkiot-envelope", definition: { kind: "builtin", name: "thinkiot-envelope" } };
const DECLARATIVE = (code: string) => ({
  code,
  definition: { kind: "declarative", root: "object", readings: [{ key: "a", field: ["a"] }] },
});

function reader(rows: { code: string; definition: unknown }[]): DiscoveryFormatsReader {
  return {
    select: () => ({ from: () => ({ orderBy: async () => rows }) }),
  } as unknown as DiscoveryFormatsReader;
}

export async function theOrderIsKeptWithNoChoice(): Promise<void> {
  const { formats, invalid } = await loadDiscoveryFormats(reader([BUILTIN, DECLARATIVE("a-fmt"), DECLARATIVE("b-fmt")]), undefined);
  expect(formats.map((f) => f.code)).toEqual(["thinkiot-envelope", "a-fmt", "b-fmt"]);
  expect(invalid).toEqual([]);
}

export async function theChosenFormatGoesFirst(): Promise<void> {
  const { formats } = await loadDiscoveryFormats(reader([BUILTIN, DECLARATIVE("a-fmt"), DECLARATIVE("b-fmt")]), "b-fmt");
  expect(formats.map((f) => f.code)).toEqual(["b-fmt", "thinkiot-envelope", "a-fmt"]);
}

export async function aChosenCodeWithNoRowChangesNothing(): Promise<void> {
  const { formats } = await loadDiscoveryFormats(reader([BUILTIN, DECLARATIVE("a-fmt")]), "no-such");
  expect(formats.map((f) => f.code)).toEqual(["thinkiot-envelope", "a-fmt"]);
}

export async function anInvalidRowIsLeftOutByCode(): Promise<void> {
  const { formats, invalid } = await loadDiscoveryFormats(
    reader([BUILTIN, { code: "broken", definition: { kind: "script", body: "secret-ish" } }]),
    "broken",
  );
  expect(formats.map((f) => f.code)).toEqual(["thinkiot-envelope"]);
  expect(invalid).toEqual(["broken"]);
}
