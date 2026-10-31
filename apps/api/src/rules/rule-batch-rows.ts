/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — the pure half of `POST /rules/batch`.
 *
 * Every row error the batch returns names the row by its **index in the sent
 * body** (`Row 3: …`, 1-based in the sentence), not by its position after the
 * user's exclusions: the card the user ticked shows the sent rows, so a number
 * counted after exclusion would point at the wrong line of the table. That is
 * why each kept row carries its original index here.
 */

/** A row the user left ticked, beside its 0-based index in the sent `rules`. */
export type KeptRow<T> = { readonly index: number; readonly rule: T };

/**
 * The rows not named in `excludedRows`, in the sent order. An index past the
 * last row removes nothing (the body schema bounds it at 24, but a 3-row batch
 * may still name 7).
 */
export function applyExcludedRows<T>(rules: readonly T[], excludedRows: readonly number[] = []): KeptRow<T>[] {
  const excluded = new Set(excludedRows);
  return rules.flatMap((rule, index) => (excluded.has(index) ? [] : [{ index, rule }]));
}

/**
 * The first two kept rows that carry the same explicit code, as their indexes
 * in the sent body (`[earlier, later]`), or `null`. A row without a code, or
 * with a blank one, is never a duplicate: its code is generated later. Codes
 * are compared trimmed and upper-cased — the body schema's preprocess already
 * did that, and the comparison does not rely on it.
 */
export function duplicateCodeRows(kept: readonly KeptRow<{ readonly code?: string | null }>[]): [number, number] | null {
  const seen = new Map<string, number>();
  for (const { index, rule } of kept) {
    const code = rule.code?.trim().toUpperCase();
    if (!code) continue;
    const earlier = seen.get(code);
    if (earlier !== undefined) return [earlier, index];
    seen.set(code, index);
  }
  return null;
}
