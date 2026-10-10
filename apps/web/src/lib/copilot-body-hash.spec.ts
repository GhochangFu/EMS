import { expect } from "vitest";

import { bodyHashHex } from "./copilot-body-hash";

/**
 * `F3.85` PR 4 / drafter choice 5 — the browser hash equals the API's. The
 * vector and both SHA-256 literals are the same as
 * `apps/api/src/copilot/body-hash.spec.ts`. `node` environment (Web Crypto
 * is a global since Node 20).
 */
const VECTOR = { b: [{ z: 1, a: null }], a: "x" };
const VECTOR_SHA256 = "cd46abb94645a78c7ce4802b707895cda25a3e69932ec5040b0fcb7abc663b64";
const EMPTY_SHA256 = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";

export async function theVectorHashesToTheSharedLiteral(): Promise<void> {
  expect(await bodyHashHex(VECTOR)).toBe(VECTOR_SHA256);
}

export async function anEmptyBodyHashesToTheBracesLiteral(): Promise<void> {
  expect(await bodyHashHex({})).toBe(EMPTY_SHA256);
}
