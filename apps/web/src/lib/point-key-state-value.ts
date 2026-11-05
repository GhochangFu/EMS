/** Decimal notation: a sign, digits with an optional fraction (or a bare fraction), an exponent. */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * `F4.309` (ADR 0088 Amendment 3 decision 4, owner ruling Q7 (a): any finite number) — a state
 * label's value text to the body's `value`, or `null` when it is not one. Decimal text only, read
 * after a trim: `Number` alone also reads `0x1`, `0b10` and `0o7`, and reads blank text as `0`.
 * `Number.isFinite` then refuses an overflow such as `1e400`. Shared by the State Labels form and,
 * in PR 3, its wizard mapping.
 */
export function parseStateValue(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
