import { expect } from "vitest";

import { REQUEST_SCHEMAS } from "./openapi-registry";
import { convertZodSchema, REFINED_MARKER } from "./zod-openapi";

/**
 * `F4.20` / ADR 0029 decision 10 — the check that makes Amendment 1 real.
 *
 * Assertions only (§4.6); `openapi-contract.test.ts` owns the runner.
 *
 * Amendment 1 says a refinement reaching the document without an explanation
 * **fails the build**. This is where that happens. Without it, decision 9b is a
 * request rather than a rule: the marker would still appear (it is derived from
 * the schema and cannot be forgotten), but it would appear on fields with
 * nothing said about them — which tells a reader that something more is checked
 * without telling them what, and still produces a `400` they cannot predict.
 *
 * No Nest application and no database: this converts the registered schemas
 * directly, so it runs in CI and on a laptop identically.
 */

/**
 * Every **registered** schema, converted, with nothing left unexplained.
 *
 * **This is deliberately the narrower of two checks, and the split is measured
 * rather than tidy.** A first version scoped decision 10 to the registry alone.
 * Mutation testing then removed a `.describe()` from `telemetryReadingSchema`
 * and moved another *before* its refinement — the exact fact F trap — and
 * **both survived**, because that schema validates ingest payloads, is bound to
 * no REST handler, and so was never reached from `REQUEST_SCHEMAS`. That is the
 * `F4.38` shape: a guard scoped to the construct that was convenient rather
 * than the one the rule is about.
 *
 * The fix is not to widen this one. Reaching every schema file from here needs
 * `import.meta.glob`, which is a Vite feature that `tsc` rejects under this
 * package's CommonJS `module` setting — it would pass `pnpm test` and fail
 * `pnpm typecheck:tests`, which is the asymmetry §4.6 exists to prevent. So the
 * whole-tree rule lives in `tests/adr-0029-openapi-contract.test.ts` as a
 * source scan, which is where this repo puts guarantees a behavioural test
 * cannot carry, and which is exactly what ADR 0029 decision 10 describes:
 * presence and order.
 *
 * What this check adds that the source scan cannot: it proves the conversion
 * *actually produces* nothing unexplained for the schemas the document is built
 * from, rather than proving the source looks right.
 */
export function testEveryRegisteredSchemaExplainsItsRefinements(): void {
  const unexplained = Object.entries(REQUEST_SCHEMAS).flatMap(
    ([id, schema]) => convertZodSchema(schema, id).unexplained,
  );

  expect(
    unexplained.map((u) => `${u.schema} at ${u.path}`),
    "These schemas carry a `.refine`/`.superRefine` that the generated document " +
      "cannot express and that nothing explains. zod-to-json-schema emits NOTHING " +
      "for a refinement, so the document would be strictly more permissive than the " +
      "API here and a caller who trusted it would receive a 400 the document says is " +
      "impossible (ADR 0029 Amendment 1 fact C). Add `.describe(...)` AFTER the " +
      "refinement — before it, the description lands on the inner schema and is " +
      "silently discarded (fact F).",
  ).toEqual([]);
}

/**
 * The registry is not empty and its schemas really do convert.
 *
 * An empty or broken registry would make the check above pass having asserted
 * nothing — the vacuous green this repo keeps rediscovering.
 */
export function testTheRegistryIsPopulatedAndConverts(): void {
  const ids = Object.keys(REQUEST_SCHEMAS);
  expect(
    ids.length,
    "the registry is empty, so every other assertion here is vacuous",
  ).toBeGreaterThan(30);

  for (const [id, schema] of Object.entries(REQUEST_SCHEMAS)) {
    const { schema: json } = convertZodSchema(schema, id);
    expect(Object.keys(json).length, `${id} converted to an empty schema`).toBeGreaterThan(0);
  }
}

/**
 * **At least one registered schema is actually marked.**
 *
 * This is the case that keeps the two above honest. If the marker ever stopped
 * being emitted — a refactor, a converter upgrade, a dropped `postProcess` —
 * `unexplained` would also be empty, and the first assertion would pass while
 * the document silently lost every declaration of its own incompleteness. That
 * is the `F4.37` shape: a guard that is still called and no longer does
 * anything.
 */
export function testTheMarkerReachesTheRealSchemas(): void {
  const marked = Object.entries(REQUEST_SCHEMAS).filter(([id, schema]) =>
    JSON.stringify(convertZodSchema(schema, id).schema).includes(REFINED_MARKER),
  );

  expect(
    marked.length,
    "no registered schema carries the refinement marker. Either every refinement " +
      "was removed from this codebase — 11 were measured across 5 files — or the " +
      "marker has stopped being emitted and the document no longer declares where " +
      "its validation is incomplete.",
  ).toBeGreaterThan(0);
}
