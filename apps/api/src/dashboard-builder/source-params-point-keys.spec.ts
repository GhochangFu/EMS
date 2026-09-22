import { sourceParamsPointKeys } from "./source-params-point-keys";

/**
 * `E4.2` U3 — the pure half of the point-key check at a catalog binding's write (ADR 0072
 * decision 2). Assertions live here; `source-params-point-keys.test.ts` is the Vitest entry
 * point (ADR 0014). One exported function per claim.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const FIVE_OLD_KEYS = [
  "alarms.active.count",
  "alarms.active",
  "workorders.open.count",
  "workorders.open",
  "assets.health.score",
] as const;

/** The five Stage C entries declare no `params`, so they contribute no point key. */
export function oldEntriesYieldNothing(): void {
  const keys = sourceParamsPointKeys(
    FIVE_OLD_KEYS.map((catalogKey) => ({ catalogKey, params: {} })),
  );
  assert(keys.length === 0, `expected [] for the five old entries, got ${JSON.stringify(keys)}`);
}

/** A `sustainability.total` binding yields its `pointKey`. */
export function sustainabilitySourceYieldsItsPointKey(): void {
  const keys = sourceParamsPointKeys([
    { catalogKey: "sustainability.total", params: { pointKey: "kl_today", aggregate: "sum" } },
  ]);
  assert(
    JSON.stringify(keys) === JSON.stringify(["kl_today"]),
    `expected ["kl_today"], got ${JSON.stringify(keys)}`,
  );
}

/** Params that fail the entry's write schema yield nothing — the schema's 400 owns that case. */
export function unparseableParamsYieldNothing(): void {
  const keys = sourceParamsPointKeys([
    { catalogKey: "sustainability.by_location", params: { pointKey: "kl today" } },
    { catalogKey: "sustainability.total", params: {} },
  ]);
  assert(keys.length === 0, `expected [] for unparseable params, got ${JSON.stringify(keys)}`);
}

/** The same key bound on two widgets is one lookup. */
export function pointKeysAreDeduplicated(): void {
  const keys = sourceParamsPointKeys([
    { catalogKey: "sustainability.total", params: { pointKey: "kl_today", aggregate: "sum" } },
    { catalogKey: "sustainability.by_location", params: { pointKey: "kl_today", aggregate: "sum" } },
    { catalogKey: "sustainability.total", params: { pointKey: "kwh_today", aggregate: "avg" } },
  ]);
  assert(
    JSON.stringify(keys) === JSON.stringify(["kl_today", "kwh_today"]),
    `expected ["kl_today","kwh_today"], got ${JSON.stringify(keys)}`,
  );
}

/** A catalog key outside the vocabulary yields nothing rather than throwing. */
export function unknownCatalogKeyYieldsNothing(): void {
  const keys = sourceParamsPointKeys([{ catalogKey: "energy.nope", params: { pointKey: "x" } }]);
  assert(keys.length === 0, `expected [] for an unknown catalog key, got ${JSON.stringify(keys)}`);
}
