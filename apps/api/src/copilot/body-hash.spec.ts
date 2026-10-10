import { expect } from "vitest";

import { bodyHash } from "./body-hash";

/**
 * `F3.85` PR 4 / drafter choice 5 — the API side of the body hash. The vector
 * and both SHA-256 literals are the same as
 * `apps/web/src/lib/copilot-body-hash.spec.ts`; the canonical form is pinned
 * in `packages/shared/src/copilot/canonical-json.spec.ts`. Vitest entry point:
 * the sibling `.test.ts`.
 */
const VECTOR = { b: [{ z: 1, a: null }], a: "x" };
const VECTOR_SHA256 = "cd46abb94645a78c7ce4802b707895cda25a3e69932ec5040b0fcb7abc663b64";
const EMPTY_SHA256 = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";

export function theVectorHashesToTheSharedLiteral(): void {
  expect(bodyHash(VECTOR)).toBe(VECTOR_SHA256);
  expect(bodyHash({ a: "x", b: [{ a: null, z: 1 }] })).toBe(VECTOR_SHA256);
}

export function anEmptyBodyHashesToTheBracesLiteral(): void {
  expect(bodyHash({})).toBe(EMPTY_SHA256);
}

/** A `clientOnly` key is removed before hashing, so the typed value never has to match the stored hash. */
export function clientOnlyKeysAreStripped(): void {
  expect(bodyHash({ ...VECTOR, temporaryPassword: "s3cret" }, ["temporaryPassword"])).toBe(VECTOR_SHA256);
  // Without the strip the same body does not match.
  expect(bodyHash({ ...VECTOR, temporaryPassword: "s3cret" })).not.toBe(VECTOR_SHA256);
  // A nested key of the same name is data, not the client-only field.
  expect(bodyHash({ a: "x", b: [{ a: null, z: 1, temporaryPassword: "s" }] }, ["temporaryPassword"])).not.toBe(
    VECTOR_SHA256,
  );
}

/** A body that is not a JSON object is hashed whole; nothing is stripped from it. */
export function aNonObjectBodyIsHashedWhole(): void {
  expect(bodyHash([VECTOR], ["a"])).toBe(bodyHash([VECTOR]));
  expect(bodyHash(null, ["a"])).toBe(bodyHash(null));
}
