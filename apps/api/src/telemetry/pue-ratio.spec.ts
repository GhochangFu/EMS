import { pueRatioOf } from "./pue-ratio";

/**
 * `F2.8` — the pure half of the PUE reader. Everything here is arithmetic; the
 * database halves (`latestPueRatio`, `windowedPueRatio`) are asserted in
 * `pue-ratio.integration.spec.ts`.
 *
 * The two rulings this file exists to hold (owner, 2026-09-05):
 *
 * - **Ruling 3** — the estate figure is kW-weighted: Σ `site_kw` / Σ `it_kw`
 *   over the incomers in scope. One incomer in scope therefore reduces to that
 *   site's own ratio, which is a property of the arithmetic rather than a
 *   special case, and the `oneIncomerIsItsOwnRatio` case pins it.
 * - **Ruling 4** — nothing configured is `null`. No `1` sentinel, no fallback
 *   curve. The fitted curve — `1.22` plus `min(0.45, totalKw / 12000)` — that
 *   used to answer this question is deleted from both services in the same
 *   commit; see `pue-ratio.ts` on why it is not spelled in its original form.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Zero incomers is not "PUE 1", it is "no answer" — the whole reason
 * `pueEstimate` went `.nullable()` in `packages/shared/src/contracts`.
 *
 * The sums are deliberately non-zero here: a scope with no *paired* incomer can
 * still carry a `site_kw` (the half-pair `HAVING COUNT(*) = 2` drops), and the
 * count is what decides, not the sums.
 */
export function assertZeroIncomersIsNull(): void {
  const got = pueRatioOf({ incomers: 0, siteKw: 0, itKw: 0 });
  assert(got === null, `no incomer in scope must be null, got ${JSON.stringify(got)}`);
  const withStrayLoad = pueRatioOf({ incomers: 0, siteKw: 900, itKw: 0 });
  assert(
    withStrayLoad === null,
    `zero incomers must be null whatever the sums say, got ${JSON.stringify(withStrayLoad)}`,
  );
}

/**
 * Ruling 4 again, at the other end: an incomer that reports `it_kw = 0` divides
 * by zero. `Infinity` is not a PUE, and `1` would be a lie the tile could not be
 * told apart from a real measurement — so it is `null`, and the page says "not
 * configured" for a reason that is at least true in kind.
 */
export function assertZeroItLoadIsNull(): void {
  const got = pueRatioOf({ incomers: 1, siteKw: 120, itKw: 0 });
  assert(got === null, `it_kw = 0 must be null, never a sentinel, got ${JSON.stringify(got)}`);
}

/**
 * The measured estate figure of 2026-09-05 (plan §3): Σ 1447.3 kW over nine
 * incomers against Σ 25.1 kW of IT load. Absurd as a PUE and honest as a
 * measurement — the simulator retune is `Task 3b`, not a fallback here.
 */
export function assertEstateIsKwWeighted(): void {
  const got = pueRatioOf({ incomers: 9, siteKw: 1447.3, itKw: 25.1 });
  assert(got === 57.66, `expected the estate ratio 57.66, got ${JSON.stringify(got)}`);
}

/** Ruling 3's single-site reduction — Western Cape's 41.1 kW over 12.6 kW. */
export function assertOneIncomerIsItsOwnRatio(): void {
  const got = pueRatioOf({ incomers: 1, siteKw: 41.1, itKw: 12.6 });
  assert(got === 3.26, `one incomer must reduce to its own ratio 3.26, got ${JSON.stringify(got)}`);
}

/**
 * Two decimal places, the same `Math.round(v * 100) / 100` both services already
 * apply to `totalKwh` and `peakKw`. The tile renders the number verbatim, so a
 * full-precision float would print seventeen significant digits.
 */
export function assertRoundsToTwoDecimals(): void {
  const third = pueRatioOf({ incomers: 1, siteKw: 1, itKw: 3 });
  assert(third === 0.33, `expected 0.33, got ${JSON.stringify(third)}`);
  const halfUp = pueRatioOf({ incomers: 1, siteKw: 2.675, itKw: 1 });
  assert(halfUp === 2.68, `expected 2.68, got ${JSON.stringify(halfUp)}`);
  const exact = pueRatioOf({ incomers: 2, siteKw: 400, itKw: 150 });
  assert(exact === 2.67, `expected 2.67, got ${JSON.stringify(exact)}`);
}

/**
 * `pueEstimate` is `z.number().nullable()` (ADR 0030), and `NaN`/`Infinity` are
 * neither — `checkResponse` on the web side would reject the whole payload and
 * the page would show an error rather than a dash. A non-finite result is the
 * same event as "not configured" as far as the reader is concerned, so it takes
 * the same answer. Same instinct as `finite-value-check.integration.spec.ts` and
 * `assertFiniteCells`.
 */
export function assertNonFiniteIsNull(): void {
  const nan = pueRatioOf({ incomers: 1, siteKw: Number.NaN, itKw: 50 });
  assert(nan === null, `NaN must not reach the contract, got ${JSON.stringify(nan)}`);
  const infinite = pueRatioOf({ incomers: 1, siteKw: Number.POSITIVE_INFINITY, itKw: 50 });
  assert(infinite === null, `Infinity must not reach the contract, got ${JSON.stringify(infinite)}`);
}
