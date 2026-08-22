/**
 * The query retry predicate (`F4.63`).
 *
 * The first assertion is the defect as measured: a 403 from `adminFetch` cost
 * four requests and ~40 seconds of "Loading…" before the refusal rendered.
 */
import { ApiError } from "./api-error";
import { MAX_QUERY_RETRIES, isNonRetryableStatus, shouldRetryQuery } from "./query-retry";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Counts the requests a predicate permits, driving it the way the library does.
 *
 * **`failureCount` is 0 on the first failure**, which is not a guess:
 * `@tanstack/query-core@5.100.5` `retryer.js` reads it at line 89 and
 * increments at line 94, so the predicate sees the failures that happened
 * *before* this one. An off-by-one here would silently assert a four-request
 * budget against a three-request rule — this helper got it wrong first, and the
 * `runRetryableStatusTests` case below is what caught it.
 */
function requestsFor(error: unknown): number {
  let failureCount = 0;
  while (shouldRetryQuery(failureCount, error)) {
    failureCount += 1;
    // A predicate that never stops is the failure this guard catches; without
    // it a bad rule hangs the suite instead of failing it.
    assert(failureCount <= 50, "the predicate never stopped retrying");
  }
  // One initial request, plus one per retry the predicate allowed.
  return failureCount + 1;
}

/** The measured case: an out-of-scope template read, refused with 403. */
export function runForbiddenTests(): void {
  const forbidden = new ApiError(
    '{"message":"Template is outside your access scope","error":"Forbidden","statusCode":403}',
    403,
  );

  assert(
    !shouldRetryQuery(1, forbidden),
    "a 403 must not be retried even once — the answer cannot change",
  );
  assert(
    requestsFor(forbidden) === 1,
    `a 403 must cost exactly one request, not ${requestsFor(forbidden)}`,
  );

  // The property that matters more than the count: an ApiError is still an
  // Error, so nothing downstream of the 42 adminFetch call sites changes.
  assert(forbidden instanceof Error, "ApiError must remain an Error");
  assert(
    forbidden.message.includes("Template is outside your access scope"),
    "ApiError must carry the body verbatim, as `new Error(text)` did",
  );
}

/** Every other 4xx a refused admin call can produce. */
export function runNonRetryableStatusTests(): void {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert(isNonRetryableStatus(status), `${status} must be treated as final`);
    assert(
      requestsFor(new ApiError("refused", status)) === 1,
      `${status} must cost exactly one request`,
    );
  }
}

/**
 * The two 4xx that mean "not now" rather than "no", and 5xx.
 *
 * This is the half that proves the rule is a rule and not "never retry an
 * ApiError" — without it, deleting the 408/429 branch and the upper bound
 * would leave every other assertion passing.
 */
export function runRetryableStatusTests(): void {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert(!isNonRetryableStatus(status), `${status} must stay retryable`);
    assert(
      requestsFor(new ApiError("try again", status)) === MAX_QUERY_RETRIES + 1,
      `${status} must keep the previous behaviour of ${MAX_QUERY_RETRIES + 1} requests`,
    );
  }
}

/**
 * The conservative half of the ruling.
 *
 * About twenty clients — `alarms.ts`, `dashboard.ts`, `energy-dashboard.ts`,
 * `locations.ts`, `assets.ts` — throw a plain `Error` with no status. Their
 * behaviour must be **byte-identical** to before this change, because the
 * defect was measured on an `adminFetch` path and nothing licensed touching
 * theirs.
 */
export function runPlainErrorTests(): void {
  const cases: unknown[] = [
    new Error("alarms 403"),
    new Error("dashboard kpis 500"),
    new TypeError("Failed to fetch"),
    "a string throw",
    null,
    undefined,
  ];
  for (const cause of cases) {
    assert(
      requestsFor(cause) === MAX_QUERY_RETRIES + 1,
      `a non-ApiError must keep the previous ${MAX_QUERY_RETRIES + 1} requests, ` +
        `got ${requestsFor(cause)} for ${String(cause)}`,
    );
  }

  // The trap this guards: `alarms.ts` throws `new Error("alarms 403")`, whose
  // text contains "403". A predicate that sniffed the message instead of
  // reading a typed status would stop retrying it, which is precisely the
  // string-shaped coupling the owner ruled against.
  assert(
    shouldRetryQuery(1, new Error("alarms 403")),
    "a plain Error whose text merely mentions 403 must still retry",
  );
}

/** The retry budget is unchanged; only which failures spend it changed. */
export function runBudgetTests(): void {
  const retryable = new ApiError("gateway", 502);
  assert(shouldRetryQuery(0, retryable), "the first failure must retry");
  assert(
    shouldRetryQuery(MAX_QUERY_RETRIES - 1, retryable),
    "the last permitted retry must still be allowed",
  );
  assert(
    !shouldRetryQuery(MAX_QUERY_RETRIES, retryable),
    "the budget must stop at MAX_QUERY_RETRIES",
  );
  assert(MAX_QUERY_RETRIES === 3, "the budget must match the library default this replaced");
}
