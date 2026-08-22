import {
  COMPUTED_SOURCE_DATA_KEY_PREFIX,
  SOURCE_DATA_KEY_MAX_LENGTH,
  computedSourceDataKey,
} from "./computed-source-data-key";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F2.6` U4 — the one format two creators share.
 *
 * These assertions look trivial and are not: the value they protect is that
 * `CalcWriteService`'s row and the override endpoint's row are the *same* row.
 * A format change in one creator would be invisible until a point that had
 * been overridden first, then computed, disagreed with one that had been
 * computed first.
 */
export function assertFormatIsExactlyComputedColonPointKey(): void {
  const result = computedSourceDataKey("DEMO_DOUBLED");
  assert(result.ok, "a short point key must format");
  assert(
    result.ok && result.sourceDataKey === "computed:DEMO_DOUBLED",
    `expected "computed:DEMO_DOUBLED", got ${result.ok ? result.sourceDataKey : "<not ok>"}`,
  );
  assert(
    COMPUTED_SOURCE_DATA_KEY_PREFIX.length === 9,
    "the prefix is 9 characters — the 119-character point-key headroom below depends on it",
  );
}

/**
 * The boundary, from both sides.
 *
 * Asserting only the failure would pass on a function that rejected
 * everything; asserting only the success would pass on one that never checked.
 */
export function assertTheLengthBoundaryIsExact(): void {
  const longest = "K".repeat(SOURCE_DATA_KEY_MAX_LENGTH - COMPUTED_SOURCE_DATA_KEY_PREFIX.length);
  const atLimit = computedSourceDataKey(longest);
  assert(
    atLimit.ok && atLimit.sourceDataKey.length === SOURCE_DATA_KEY_MAX_LENGTH,
    `a point key of ${longest.length} chars must format to exactly ${SOURCE_DATA_KEY_MAX_LENGTH}`,
  );

  const overLimit = computedSourceDataKey(`${longest}X`);
  assert(
    !overLimit.ok,
    "one character over the column width must be refused, not truncated — truncating " +
      "would collide two long point keys onto one source_data_key",
  );
  assert(
    !overLimit.ok && overLimit.reason === "too_long",
    "the refusal must say why, so the caller can log the pair it skipped",
  );
  assert(
    !overLimit.ok && overLimit.length === SOURCE_DATA_KEY_MAX_LENGTH + 1,
    `the refusal must carry the actual length; got ${overLimit.ok ? "<ok>" : overLimit.length}`,
  );
}

/** It refuses rather than throwing — a caller mid-batch has other pairs to write. */
export function assertItNeverThrows(): void {
  const huge = computedSourceDataKey("Z".repeat(5000));
  assert(!huge.ok, "a wildly oversized key must be refused");
}
