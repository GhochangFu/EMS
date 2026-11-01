import { trendStripRangeSchema } from "./trend-strip";
import { TREND_STRIP_WIDGET_ROWS, trendStripWidgetConfigSchema } from "./trend-strip-widget";

/**
 * `F4.305` U1 (ADR 0108 Amendment 3) — the `trend_strip` widget's stored config and its height.
 * Assertions here; the sibling `.test.ts` is the Vitest entry (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertTheWidgetIsFourRowsTall(): void {
  assert(TREND_STRIP_WIDGET_ROWS === 4, `the strip is 4 grid rows, got ${TREND_STRIP_WIDGET_ROWS}`);
}

export function assertTheConfigIsAPlainObject(): void {
  // Plain `ZodObject`: the write side composes `.strict()` onto it (`bindsNothingArm`).
  assert(
    typeof (trendStripWidgetConfigSchema as unknown as { strict?: unknown }).strict === "function",
    "the config schema must be a plain ZodObject so .strict() is available",
  );
}

export function assertAnEmptyConfigFails(): void {
  assert(
    trendStripWidgetConfigSchema.safeParse({}).success === false,
    "defaultRange is required: an empty config must fail",
  );
}

export function assertEachRangeAndAnOptionalTabKeyParse(): void {
  for (const defaultRange of ["24h", "7d", "30d"]) {
    assert(
      trendStripWidgetConfigSchema.safeParse({ defaultRange }).success,
      `${defaultRange} must parse`,
    );
  }
  assert(
    trendStripWidgetConfigSchema.safeParse({ tabKey: "hvac", defaultRange: "7d" }).success,
    "a tabKey beside a range must parse",
  );
}

export function assertTheRangesEqualTheStripQueryRanges(): void {
  const shape = trendStripWidgetConfigSchema.shape.defaultRange.options;
  assert(
    JSON.stringify(shape) === JSON.stringify(trendStripRangeSchema.options),
    `the widget ranges must equal the strip query ranges, got ${JSON.stringify(shape)}`,
  );
}

export function assertAnUnknownRangeOrKeyFails(): void {
  assert(
    trendStripWidgetConfigSchema.safeParse({ defaultRange: "1y" }).success === false,
    "1y is not a range",
  );
  assert(
    trendStripWidgetConfigSchema.safeParse({ tabKey: "Bad Key", defaultRange: "24h" }).success === false,
    "a tabKey must be a tab key (lowercase letters, digits, hyphens)",
  );
}
