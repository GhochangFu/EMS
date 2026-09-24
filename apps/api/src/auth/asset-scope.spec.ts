import { intersectReadable } from "./asset-scope";

/**
 * `F3.28` (ADR 0074, plan decision 2) — `intersectReadable` never widens a
 * caller's readable scope, whatever it is asked to narrow by.
 *
 * One claim per exported function; `asset-scope.test.ts` is the vitest entry
 * point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: string[] | null, expected: string[] | null, what: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${what} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/** No request, unrestricted reader — stays unrestricted. */
export function assertNoRequestUnrestrictedReaderStaysNull(): void {
  assertEqual(intersectReadable(null, undefined), null, "(null, undefined)");
}

/** No readable bound, a request — the request stands as-is, nothing to narrow against. */
export function assertNoBoundWithRequestReturnsTheRequest(): void {
  assertEqual(intersectReadable(null, ["a"]), ["a"], "(null, [a])");
}

/** A bound, no request — the bound stands untouched. */
export function assertBoundWithNoRequestReturnsTheBound(): void {
  assertEqual(intersectReadable(["a", "b"], undefined), ["a", "b"], "([a,b], undefined)");
}

/**
 * A bound and a request that partially overlaps — the intersection, which is
 * the whole point of this function: an id outside the bound must be dropped,
 * never let through because it was asked for.
 */
export function assertBoundWithPartialOverlapRequestIntersects(): void {
  assertEqual(intersectReadable(["a", "b"], ["b", "c"]), ["b"], "([a,b], [b,c])");
}

/** A bound and a request with no overlap at all — the empty result, not an error. */
export function assertBoundWithNoOverlapRequestReturnsEmpty(): void {
  assertEqual(intersectReadable(["a"], ["c"]), [], "([a], [c])");
}

/** An already-empty bound stays empty, whatever is requested. */
export function assertEmptyBoundStaysEmpty(): void {
  assertEqual(intersectReadable([], ["a"]), [], "([], [a])");
}
