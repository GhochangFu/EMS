import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Reads a file with its comments removed.
 *
 * Not tidiness — correctness. These docblocks quote the defect they fixed, so
 * `main.tsx` contains the literal text `new QueryClient()` inside a comment
 * explaining what it used to be. Scanning the raw file made the "no options
 * again" check fail against code that is correct, and the mirror-image risk is
 * worse: a prose mention of `shouldRetryQuery` would satisfy a positive check
 * over a file that had stopped calling it.
 */
function source(relative: string): string {
  return readFileSync(join(repoRoot, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * `F4.63` — the retry rule is only worth having if it is wired in.
 *
 * `apps/web/src/lib/query-retry.spec.ts` proves the predicate returns the right
 * answers, and on its own that is a tautology: deleting the `defaultOptions`
 * from `main.tsx` would restore the defect verbatim and leave every one of
 * those assertions green. The rule lives in `lib/` precisely because
 * `apps/web`'s Vitest project runs `environment: "node"` over `src/**‍/*.test.ts`
 * and cannot reach a `.tsx` — so nothing behavioural can gate the wiring, and a
 * source scan is what is left.
 *
 * This is the same failure `F4.52` shipped and its correctness review caught:
 * a fix whose test agreed with whatever it found. The scan is deliberately
 * narrow — it asserts the two lines that carry the behaviour, not the shape of
 * either file.
 */
describe("F4.63 — the retry predicate is wired in", () => {
  it("main.tsx gives QueryClient a queries.retry of shouldRetryQuery", () => {
    const main = source("apps/web/src/main.tsx");

    // Positive control. Without it, a main.tsx that had stopped constructing a
    // QueryClient at all would satisfy the assertions below by absence.
    expect(
      /new QueryClient\(/.test(main),
      "main.tsx no longer constructs a QueryClient, so the checks below are asserting " +
        "against a file that configures nothing. Fix the control before trusting them.",
    ).toBe(true);

    expect(
      /import \{ shouldRetryQuery \} from "\.\/lib\/query-retry"/.test(main),
      "main.tsx no longer imports shouldRetryQuery. The rule and its spec would still " +
        "pass while every query went back to the library default retry: 3 — which is " +
        "the F4.63 defect: a 403 costing four requests and ~40s of 'Loading…'.",
    ).toBe(true);

    expect(
      /defaultOptions:\s*\{\s*queries:\s*\{\s*retry:\s*shouldRetryQuery\s*\}/.test(main),
      "main.tsx no longer passes shouldRetryQuery as defaultOptions.queries.retry. " +
        "Importing it is not enough — an unused import restores the defect silently.",
    ).toBe(true);

    // `new QueryClient()` with no argument is the exact prior state.
    expect(
      /new QueryClient\(\s*\)/.test(main),
      "main.tsx constructs QueryClient with no options again, which is the F4.63 defect " +
        "verbatim.",
    ).toBe(false);
  });

  it("adminFetch throws ApiError carrying the response status", () => {
    const client = source("apps/web/src/api/admin/client.ts");

    // Positive control: the refusal branch must still exist to throw from.
    expect(
      /if \(!res\.ok\)/.test(client),
      "adminFetch no longer has a !res.ok branch, so the throw assertion below is " +
        "checking a path that cannot run.",
    ).toBe(true);

    expect(
      /throw new ApiError\([^)]*res\.status\)/.test(client),
      "adminFetch no longer throws an ApiError carrying res.status. shouldRetryQuery " +
        "reads that status; without it every admin refusal becomes a statusless Error " +
        "and falls into the retry-anyway branch, restoring F4.63 for the admin pages " +
        "it was measured on.",
    ).toBe(true);
  });

  it("query-retry does not sniff the error message for a status", () => {
    const rule = source("apps/web/src/lib/query-retry.ts");

    // The alternative shape the owner ruled against on 2026-08-22: parsing
    // `statusCode` out of the error text. It works today and breaks silently
    // the day an error envelope changes — and `alarms.ts` throws
    // `new Error("alarms 403")`, whose text contains a status that is not one.
    expect(
      /\.message|JSON\.parse|statusCode/.test(rule),
      "query-retry.ts reads an error's message text. The status must come from " +
        "ApiError.status, not from parsing a body — see the F4.63 row.",
    ).toBe(false);
  });
});
