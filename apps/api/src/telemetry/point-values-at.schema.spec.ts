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

/** A missing `at` is refused. */
export function assertMissingAtIsRefused(): void {
  const result = pointValuesAtQuerySchema.safeParse(parseAsTheApiDoes(`refs=${refs(1)[0]}`));
  assert(result.success === false, "a missing `at` must be refused");
}
