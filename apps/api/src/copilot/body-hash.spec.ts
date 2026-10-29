import { expect } from "vitest";

import { hashExcludedKeysFor } from "@bms/shared/copilot";

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

/** `F4.279` (Q12): a dotted `clientOnly` path strips the nested key, so the typed webhook URL never has to match the stored hash. */
export function aNestedClientOnlyPathIsStripped(): void {
  const typed = { name: "Hook", config: { to: ["a@example.test"], url: "https://hooks.example.test/x" } };
  const stored = { name: "Hook", config: { to: ["a@example.test"] } };
  expect(bodyHash(typed, ["config.url"])).toBe(bodyHash(stored));
}

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — the batch card's owed claim: the user's `excludedRows` and
 * the server's `checks` leave the hash, so a Confirm that only unticks rows matches the stored
 * hash of `{ rules }`. Mutation: hash with `clientOnly` only (drop `cardOnly`) → this reddens.
 */
const BATCH_ROW = (pointKey: string, thresholdValue: number) => ({
  name: `Chiller ${pointKey}`,
  ruleType: "threshold",
  assetId: "55555555-5555-4555-8555-555555555555",
  pointKey,
  operator: "gt",
  thresholdValue,
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
});
const BATCH_RULES = [BATCH_ROW("supply_temp_c", 3), BATCH_ROW("return_temp_c", 9)];

export function theBatchHashLeavesOutExcludedRowsAndChecks(): void {
  const sent = { rules: BATCH_RULES, excludedRows: [1], checks: [{ row: 1 }, { row: 2 }] };
  expect(bodyHash(sent, hashExcludedKeysFor("rule.createBatch"))).toBe(bodyHash({ rules: BATCH_RULES }, []));
}

/** The user can only leave a row out: a changed threshold, a third row or a reordered `rules` each move the hash. */
export function aChangedAddedOrReorderedRowMovesTheBatchHash(): void {
  const keys = hashExcludedKeysFor("rule.createBatch");
  const stored = bodyHash({ rules: BATCH_RULES }, []);
  const [first, second] = BATCH_RULES as [ReturnType<typeof BATCH_ROW>, ReturnType<typeof BATCH_ROW>];
  const changed = [{ ...first, thresholdValue: 4 }, second];
  const added = [first, second, BATCH_ROW("flow_m3h", 1)];
  const reordered = [second, first];
  for (const [label, rules] of [["changed", changed], ["added", added], ["reordered", reordered]] as const) {
    expect(bodyHash({ rules, excludedRows: [] }, keys), label).not.toBe(stored);
  }
}
