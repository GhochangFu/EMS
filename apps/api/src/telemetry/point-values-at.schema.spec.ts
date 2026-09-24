import { createRequire } from "node:module";

import { MAX_AT_INSTANT_REFS, pointValuesAtQuerySchema } from "./telemetry.schema";

/**
 * `F3.28` (ADR 0074 decision 2 / plan decision 2) — `pointValuesAtQuerySchema`'s
 * `refs` fold and its bound, and `at`'s offset requirement.
 *
 * One claim per exported function; `point-values-at.schema.test.ts` is the
 * vitest entry point (ADR 0014). The query-string cases parse through the
 * API's own Express query parser, exactly as
 * `apps/api/src/auth/asset-scope.schema.spec.ts` does — a hand-built array
 * would not exercise the `qs` `arrayLimit: 20` overflow shape that is the
 * whole reason `refs` needs the fold.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const AT = "2026-09-24T10:00:00.000Z";

function refs(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `ref-${i}`);
}

// Loaded once, at import — the same reason `asset-scope.schema.spec.ts` gives:
// a cold `require("express")` inside the first `it()` took over a second alone
// and crossed the 5 s timeout in a combined run.
const apiQueryParser = (
  createRequire(require.resolve("@nestjs/platform-express"))("express") as () => {
    get(name: string): (q: string) => Record<string, unknown>;
  }
)().get("query parser fn");

function parseAsTheApiDoes(query: string): Record<string, unknown> {
  return apiQueryParser(query);
}

function refsQueryString(at: string, values: string[]): string {
  return [`at=${encodeURIComponent(at)}`, ...values.map((v) => `refs=${v}`)].join("&");
}

/** A single `?refs=a` becomes a one-element array. */
export function assertOneRefParses(): void {
  const result = pointValuesAtQuerySchema.safeParse(parseAsTheApiDoes(refsQueryString(AT, refs(1))));
  assert(
    result.success === true,
    `1 ref must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`,
  );
  assert(
    result.success && JSON.stringify(result.data.refs) === JSON.stringify(refs(1)),
    "1 ref must normalise to a one-element array",
  );
}

/**
 * 21 refs — one past qs's `arrayLimit: 20` — must still parse. This is the
 * case that catches a missing fold: without it, qs hands back an index-keyed
 * object at 21 repeats and `z.array` refuses it.
 */
export function assertTwentyOneRefsParse(): void {
  const sent = refs(21);
  const result = pointValuesAtQuerySchema.safeParse(parseAsTheApiDoes(refsQueryString(AT, sent)));
  assert(
    result.success === true,
    `21 refs must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`,
  );
  assert(
    result.success && JSON.stringify(result.data.refs) === JSON.stringify(sent),
    "21 refs must arrive in the order sent",
  );
}

/** Exactly the cap (50) parses. */
export function assertFiftyRefsParse(): void {
  const result = pointValuesAtQuerySchema.safeParse(
    parseAsTheApiDoes(refsQueryString(AT, refs(MAX_AT_INSTANT_REFS))),
  );
  assert(
    result.success === true,
    `${MAX_AT_INSTANT_REFS} refs must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`,
  );
}

/** One past the cap (51) is refused. */
export function assertFiftyOneRefsAreRefused(): void {
  const result = pointValuesAtQuerySchema.safeParse(
    parseAsTheApiDoes(refsQueryString(AT, refs(MAX_AT_INSTANT_REFS + 1))),
  );
  assert(result.success === false, `${MAX_AT_INSTANT_REFS + 1} refs must be refused`);
}

/** `at` without an explicit offset (a bare local time) is refused. */
export function assertAtWithoutOffsetIsRefused(): void {
  const result = pointValuesAtQuerySchema.safeParse(
    parseAsTheApiDoes(refsQueryString("2026-09-24T10:00:00.000", refs(1))),
  );
  assert(result.success === false, "an `at` with no offset must be refused");
}

/** An unknown query key is refused — the schema is `.strict()`. */
export function assertAnUnknownKeyIsRefused(): void {
  const result = pointValuesAtQuerySchema.safeParse(
    parseAsTheApiDoes(`${refsQueryString(AT, refs(1))}&bogus=1`),
  );
  assert(result.success === false, "an unknown query key must be refused");
}

/**
 * `at` is bounded to `[1970-01-01T00:00:00Z, now + 1 day]`: outside it the
 * instant reaches Postgres, which refuses year 0 as a `timestamptz` — a 500.
 * Each bound is its own function, with an in-range positive control, so a
 * mutation to one side reddens that side's case.
 */
function atIsRefused(at: string): boolean {
  const result = pointValuesAtQuerySchema.safeParse(parseAsTheApiDoes(refsQueryString(at, refs(1))));
  return (
    result.success === false &&
    result.error.issues.some((i) => i.path[0] === "at" && i.message.startsWith("at must lie between"))
  );
}

/** Year 0 — a valid datetime string, and a 500 in Postgres — is the range refine's 400. */
export function assertAtInYearZeroIsRefused(): void {
  assert(atIsRefused("0000-01-01T00:00:00Z"), "an `at` in year 0 must be refused by the range bound");
}

/** One second before the epoch is refused by the lower bound. */
export function assertAtBeforeTheEpochIsRefused(): void {
  assert(atIsRefused("1969-12-31T23:59:59Z"), "an `at` in 1969 must be refused by the range bound");
}

/** More than one day past the clock is refused by the upper bound. */
export function assertAtFarInTheFutureIsRefused(): void {
  const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
  assert(atIsRefused(future), `an \`at\` two days ahead (${future}) must be refused by the range bound`);
  assert(atIsRefused("9999-12-31T23:59:59Z"), "an `at` in year 9999 must be refused by the range bound");
}

/** The positive control: an ordinary past instant, and the epoch itself, parse. */
export function assertAnOrdinaryPastAtParses(): void {
  for (const at of [AT, "1970-01-01T00:00:00Z", new Date(Date.now() - 86_400_000).toISOString()]) {
    const result = pointValuesAtQuerySchema.safeParse(parseAsTheApiDoes(refsQueryString(at, refs(1))));
    assert(
      result.success === true && result.data.at === at,
      `${at} must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`,
    );
  }
}

/** A missing `at` is refused. */
export function assertMissingAtIsRefused(): void {
  const result = pointValuesAtQuerySchema.safeParse(parseAsTheApiDoes(`refs=${refs(1)[0]}`));
  assert(result.success === false, "a missing `at` must be refused");
}
