import { describe } from "vitest";

import { runPointFieldsTests } from "./point-fields.spec";

/**
 * Vitest entry point for `point-fields.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014). `runPointFieldsTests()` registers the `it`
 * blocks; the type-level `@ts-expect-error` fixtures and their own
 * describe/it run simply by the sibling being imported.
 */
describe("derived() overloads (F2.9 Task 8, ADR 0055 decision 10)", () => {
  runPointFieldsTests();
});
