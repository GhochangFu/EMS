import type { StockAssetTemplateEntry } from "./types";

/**
 * `F2.12` Task 1 — the spread constants and the derived-point helper every
 * electrical class module needs, pulled out of `electrical.ts` when that file
 * split into one module per class. A leaf module: it imports only `./types`,
 * so none of the six class modules can form an import cycle through here.
 *
 * Six copies of the same seven null calc fields is the DRY violation this
 * file prevents; `derived()` is also the only way to guarantee a derived
 * point never accidentally carries `calcIntervalSeconds` beside
 * `calcTrigger: "streaming"`, which `templatePointBodySchema`'s
 * `superRefine` refuses outright.
 */

/** A `StockAssetTemplateEntry`'s point body, unwrapped once for reuse here. */
type StockTemplatePoint = StockAssetTemplateEntry["points"][number];

/** A measured point's seven null calc fields, spelled once. Spread first. */
export const MEASURED = {
  kind: "measured",
  sourceDataKeyPattern: null,
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
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

/** Overrides `derived()` accepts beyond its streaming default. */
type DerivedOverrides = Partial<
  Pick<StockTemplatePoint, "maxInputAgeSeconds" | "calcIntervalSeconds" | "calcTrigger">
>;

/**
 * A derived point's shared shape (plan §5): `kind: "derived"`,
 * `formulaDialect: "bms-calc-v1"`, `calcTrigger: "streaming"`,
 * `calcIntervalSeconds: null` (a streaming point must not carry one — the
 * schema refuses it), no `sourceDataKeyPattern`, and `maxInputAgeSeconds:
 * null` unless `opts` overrides it. `oil_rise_over_ambient_c` is the one
 * point in the row that overrides it, to 3600 s (plan §4.2) — `ambient_temp_c`
 * is a slow-updating site sensor and the 300 s default would silently starve
 * the formula of a fresh input.
 */
export function derived(formula: string, opts: DerivedOverrides = {}) {
  return {
    kind: "derived",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "streaming",
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    sourceDataKeyPattern: null,
    formula,
    ...opts,
  } as const;
}
