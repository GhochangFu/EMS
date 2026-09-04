import type { CalcDialect } from "@bms/shared";

import type { StockAssetTemplateEntry } from "./types";

/**
 * `F2.12` Task 1 — the spread constants and the derived-point helper every
 * electrical class module needs, pulled out of `electrical.ts` when that file
 * split into one module per class. A leaf module: it imports only `./types`
 * and `@bms/shared`'s `CalcDialect` type, so none of the six class modules
 * can form an import cycle through here.
 *
 * Six copies of the same eight null calc fields is the DRY violation this
 * file prevents. `derived()` guarantees two pairings, one per overload
 * (`F2.9` Task 8, ADR 0055 decision 10): the plain call still guarantees a
 * derived point is `v1` streaming with a null interval — the pairing
 * `templatePointBodySchema`'s `superRefine` refuses outright — and the
 * `calcTrigger: "scheduled"` overload is the only way to get a `v2`
 * (`bms-calc-v2`) derived point at all, because a `v2` formula must be
 * scheduled (decision 10) and `formulaDialect` is not admissible beside
 * anything else.
 */

/** A `StockAssetTemplateEntry`'s point body, unwrapped once for reuse here. */
type StockTemplatePoint = StockAssetTemplateEntry["points"][number];

/** A measured point's eight null calc fields, spelled once. Spread first. */
export const MEASURED = {
  kind: "measured",
  sourceDataKeyPattern: null,
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
  // ADR 0055 decision 11 (`F2.9` Task 8) — a measured point has no aggregate
  // to cover.
  minCoverageRatio: null,
} as const;

/** Tier `C` — `required: true` beside it, always. */
export const CORE = { tier: "core" } as const;
/** Tier `X` — `required: false` beside it, always. */
export const EXTENDED = { tier: "extended" } as const;
/**
 * Tier `M` — `required: false` beside it, always. The tag list's `M` column:
 * entered by hand via `F1.8` manual entry / `F1.9` import, never mapped from
 * `sourceDataKeyPattern` (plan §5, ADR 0040 decision 3). First used by the
 * five `F2.12` classes that carry `manual` rows — `F2.13`'s feeder had none.
 */
export const MANUAL = { tier: "manual" } as const;

/** `derived()`'s plain (`v1` streaming) return shape. */
type StreamingDerivedPoint = {
  readonly kind: "derived";
  readonly formulaDialect: "bms-calc-v1";
  readonly calcTrigger: "streaming";
  readonly calcIntervalSeconds: null;
  readonly maxInputAgeSeconds: number | null;
  readonly sourceDataKeyPattern: null;
  readonly formula: string;
  readonly minCoverageRatio: null;
};

/**
 * `derived()`'s `calcTrigger: "scheduled"` return shape — `F2.9` Task 8,
 * ADR 0055 decision 10. `minCoverageRatio` is meaningful only here: a
 * streaming point has no aggregate to cover, so `StreamingDerivedPoint`
 * pins it to `null` rather than exposing it as a no-op override.
 */
type ScheduledDerivedPoint = {
  readonly kind: "derived";
  readonly formulaDialect: CalcDialect;
  readonly calcTrigger: "scheduled";
  readonly calcIntervalSeconds: number;
  readonly maxInputAgeSeconds: number | null;
  readonly sourceDataKeyPattern: null;
  readonly formula: string;
  readonly minCoverageRatio: number | null;
};

/**
 * The overrides the plain (streaming) overload accepts. Deliberately not
 * `calcTrigger` or `calcIntervalSeconds`: that overload's guarantee is that a
 * derived point is `v1` streaming with a null interval — the pair the schema
 * refuses — and a type admitting either override on it would let a caller
 * break that guarantee and compile (the `F2.12` code review found the first
 * draft did).
 */
type StreamingOverrides = Partial<Pick<StockTemplatePoint, "maxInputAgeSeconds">>;

/** The overrides the `calcTrigger: "scheduled"` overload accepts. */
type ScheduledOverrides = {
  calcTrigger: "scheduled";
  calcIntervalSeconds: number;
  formulaDialect?: CalcDialect;
  minCoverageRatio?: number | null;
  maxInputAgeSeconds?: number | null;
};

/**
 * A derived point's shared shape (plan §5). The plain call keeps `F2.12`'s
 * original guarantee: `kind: "derived"`, `formulaDialect: "bms-calc-v1"`,
 * `calcTrigger: "streaming"`, `calcIntervalSeconds: null` (a streaming point
 * must not carry one — the schema refuses it), no `sourceDataKeyPattern`,
 * `minCoverageRatio: null` (nothing to cover), and `maxInputAgeSeconds: null`
 * unless `opts` overrides it. `oil_rise_over_ambient_c` is the one point in
 * the row that overrides it, to 3600 s (plan §4.2) — `ambient_temp_c` is a
 * slow-updating site sensor and the 300 s default would silently starve the
 * formula of a fresh input.
 *
 * The `calcTrigger: "scheduled"` overload (`F2.9` Task 8, ADR 0055
 * decision 10) is the only way to get a `v2` derived point: `formulaDialect:
 * "bms-calc-v2"` is not admissible on the plain overload, so a `v2` formula
 * can only ever be scheduled, matching the decision. **No stock entry uses
 * this overload yet** — `F2.8`'s PUE entry is its first caller; every one of
 * the 18 existing callers passes no `calcTrigger` and resolves to the first
 * overload, unchanged.
 */
export function derived(formula: string, opts?: StreamingOverrides): StreamingDerivedPoint;
export function derived(formula: string, opts: ScheduledOverrides): ScheduledDerivedPoint;
export function derived(
  formula: string,
  opts: StreamingOverrides | ScheduledOverrides = {},
): StreamingDerivedPoint | ScheduledDerivedPoint {
  if ("calcTrigger" in opts && opts.calcTrigger === "scheduled") {
    return {
      kind: "derived",
      formulaDialect: opts.formulaDialect ?? "bms-calc-v1",
      calcTrigger: "scheduled",
      calcIntervalSeconds: opts.calcIntervalSeconds,
      maxInputAgeSeconds: opts.maxInputAgeSeconds ?? null,
      sourceDataKeyPattern: null,
      formula,
      minCoverageRatio: opts.minCoverageRatio ?? null,
    };
  }
  return {
    kind: "derived",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "streaming",
    calcIntervalSeconds: null,
    maxInputAgeSeconds: opts.maxInputAgeSeconds ?? null,
    sourceDataKeyPattern: null,
    formula,
    minCoverageRatio: null,
  };
}
