import { expect } from "vitest";

import { fileFor, forgetFiles, rememberFiles, sha256Hex } from "./copilot-file-memory";

/**
 * `F4.283` (ADR 0099 Amendment 8 Q19, drafter choice 5) — the per-tab kept
 * files. The digest is injected: jsdom may lack `crypto.subtle`. Vitest entry
 * point: the sibling `.test.ts`.
 */

/** A digest that answers the bytes' length in its first byte, so two files of other sizes differ. */
const fakeDigest = async (bytes: ArrayBuffer): Promise<ArrayBuffer> => {
  const out = new Uint8Array(32);
  out[0] = bytes.byteLength;
  return out.buffer;
};

export async function theHashIsLowerCaseHex(): Promise<void> {
  expect(await sha256Hex(new File(["abc"], "a.csv"), fakeDigest)).toBe(`03${"00".repeat(31)}`);
}

export async function aRememberedFileIsFoundByItsHash(): Promise<void> {
  forgetFiles();
  const file = new File(["a,b\n1,2\n"], "readings.csv");
  await rememberFiles([file], fakeDigest);
  expect(fileFor(await sha256Hex(file, fakeDigest))).toBe(file);
}

export async function anotherHashFindsNothing(): Promise<void> {
  forgetFiles();
  await rememberFiles([new File(["a,b\n1,2\n"], "readings.csv")], fakeDigest);
  expect(fileFor("f".repeat(64))).toBeUndefined();
}
