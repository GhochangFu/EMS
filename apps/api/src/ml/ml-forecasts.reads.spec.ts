import { expect } from "vitest";

import { uuidArray } from "./ml-forecasts.reads";

/**
 * `E1.4a` — the one piece of `ml-forecasts.reads.ts` a unit test can hold without a database:
 * the `uuid[]` literal the list read binds (PR 1 security review L2). The SQL itself is held by
 * `ml-forecasts.integration.spec.ts`. Entry point: `ml-forecasts.reads.test.ts` (ADR 0014).
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

export function aUuidListBecomesOneArrayLiteral(): void {
  expect(uuidArray([A, B])).toBe(`{${A},${B}}`);
  expect(uuidArray([])).toBe("{}");
}

export function anElementThatIsNotAUuidIsRefused(): void {
  for (const bad of [`${A},${B}`, `${A}}`, `"${A}"`, "not-a-uuid", ""]) {
    expect(() => uuidArray([A, bad]), JSON.stringify(bad)).toThrow(/not a UUID/);
  }
}
