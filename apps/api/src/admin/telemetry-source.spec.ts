import { omitTelemetrySource, withTelemetrySource } from "./telemetry-source";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F4.139` — the pure half of the `telemetrySource` seam.
 *
 * Assertions live here and the `it()` blocks in the sibling `.test.ts`
 * (ADR 0014, AGENTS.md §4.6). One exported assert-function per claim: `assert`
 * throws, so two claims in one block would hide the second whenever the first
 * fails.
 *
 * `resolveTelemetrySource` is not covered here — it reads
 * `rtu_connection_configs` on the caller's transaction, and a fake `tx` would
 * assert the query this file happens to build rather than the row that comes
 * back. Its six cases are in `telemetry-source.integration.spec.ts`.
 */

/** With no bag at all the derived key is still written. */
export function assertAnAbsentBagBecomesTheDerivedKey(): void {
  const merged = withTelemetrySource(undefined, "mqtt");
  assert(
    JSON.stringify(merged) === JSON.stringify({ telemetrySource: "mqtt" }),
    `expected exactly { telemetrySource: "mqtt" }, got ${JSON.stringify(merged)}`,
  );
}

/**
 * The derived value wins over a caller-supplied one, and the sibling key lives.
 *
 * Two mutations die here and neither dies without both halves of the fixture: a
 * `{ telemetrySource, ...meta }` spread-order swap (the caller would win), and
 * a replace-not-merge that drops `telemetryEnabled` — the key `apps/sim` reads
 * in the same query, so dropping it re-enables simulation on an asset an
 * operator had switched off.
 */
export function assertTheDerivedValueWinsAndTheSiblingKeySurvives(): void {
  const merged = withTelemetrySource(
    { telemetrySource: "catalog", telemetryEnabled: "false" },
    "mqtt",
  );
  assert(
    merged.telemetrySource === "mqtt" && merged.telemetryEnabled === "false",
    `expected { telemetrySource: "mqtt", telemetryEnabled: "false" }, got ${JSON.stringify(merged)}`,
  );
}

/**
 * The caller's object is not mutated.
 *
 * The input carries `telemetrySource: "catalog"` on purpose: an
 * `Object.assign(meta, …)` implementation would leave a `{ foo: "bar" }` input
 * looking untouched on every key the assertion could name.
 *
 * Split from the identity claim below on review: `assert` throws, so the two
 * together would have hidden the second one exactly as this file's header says
 * it must not.
 */
export function assertTheInputBagIsNotMutated(): void {
  const input = { telemetrySource: "catalog", telemetryEnabled: "false" };
  withTelemetrySource(input, "mqtt");
  assert(
    input.telemetrySource === "catalog",
    `expected the caller's bag to still read "catalog", got ${input.telemetrySource}`,
  );
}

/** And the merge hands back a new object rather than the caller's own bag. */
export function assertTheMergeReturnsANewObject(): void {
  const input = { telemetrySource: "catalog", telemetryEnabled: "false" };
  const merged = withTelemetrySource(input, "mqtt");
  assert(merged !== input, "expected a new object, not the caller's own bag");
}

/**
 * `omitTelemetrySource` strips the key a caller had no right to set.
 *
 * The security half of the review: with no RTU attached there is nothing to
 * derive from, so before this the API accepted a caller-supplied
 * `meta.telemetrySource` verbatim and stored it — a supported way to write a
 * row `apps/sim` and the ingest host disagree about.
 */
export function assertOmitRemovesTheKey(): void {
  const stripped = omitTelemetrySource({ telemetrySource: "mqtt", foo: "bar" });
  assert(
    stripped !== null && !("telemetrySource" in stripped),
    `expected no telemetrySource key, got ${JSON.stringify(stripped)}`,
  );
}

/** It strips that one key only; every sibling is kept. */
export function assertOmitKeepsTheSiblingKeys(): void {
  const stripped = omitTelemetrySource({ telemetrySource: "mqtt", foo: "bar" });
  assert(
    JSON.stringify(stripped) === JSON.stringify({ foo: "bar" }),
    `expected exactly { foo: "bar" }, got ${JSON.stringify(stripped)}`,
  );
}

/**
 * A null bag stays null rather than becoming `{}`.
 *
 * `bms.assets.meta` is nullable and "no bag" is not "an empty bag": the
 * callers store this value directly, and `{}` would rewrite every unattached
 * asset's NULL on the first edit.
 */
export function assertOmitLeavesANullBagNull(): void {
  const stripped = omitTelemetrySource(null);
  assert(stripped === null, `expected null, got ${JSON.stringify(stripped)}`);
}

/** An absent bag is null too — `create` stores the return value as it is. */
export function assertOmitLeavesAnAbsentBagNull(): void {
  const stripped = omitTelemetrySource(undefined);
  assert(stripped === null, `expected null, got ${JSON.stringify(stripped)}`);
}

/**
 * The caller's object is not mutated.
 *
 * A `delete meta.telemetrySource` implementation passes every assertion above
 * and still edits a bag another statement may still read.
 */
export function assertOmitDoesNotMutateTheInput(): void {
  const input = { telemetrySource: "mqtt", foo: "bar" };
  omitTelemetrySource(input);
  assert(
    input.telemetrySource === "mqtt",
    `expected the caller's bag to still read "mqtt", got ${input.telemetrySource}`,
  );
}
