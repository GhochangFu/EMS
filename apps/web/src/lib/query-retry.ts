import { ApiError } from "./api-error";

/**
 * Whether TanStack Query should retry a failed query (`F4.63`).
 *
 * ## The defect
 *
 * `main.tsx` constructed `new QueryClient()` with no `defaultOptions`, so every
 * query took the library default `retry: 3` with exponential backoff. Measured
 * on the running stack: `phe-admin@bms.local` opening an out-of-scope template
 * by URL produced **four** `GET /api/v1/admin/asset-templates/:id → 403` and
 * about **40 seconds** of "Loading template…" before ADR 0038 decision 10's
 * sentence appeared. A 403 is not retryable — the answer cannot change — so
 * three of those four calls were spent waiting to be refused again.
 *
 * Invisible before `F4.52`: the first 403 cleared the session and the flow
 * ended at `/login`, so nobody ever saw the other three.
 *
 * ## Why this is conservative, and not the tidier rule
 *
 * A `defaultOptions.queries.retry` predicate changes **all 45** `useQuery`
 * sites at once, and a sweep found not one per-query `retry:` override — so
 * nothing in this app currently opts out of anything. Meanwhile `adminFetch`
 * is only one of about twenty throw sites: `alarms.ts`, `dashboard.ts`,
 * `energy-dashboard.ts`, `locations.ts` and `assets.ts` all throw a plain
 * `Error` with no status attached.
 *
 * So the rule refuses to retry **only** what it can positively identify as a
 * non-retryable refusal. A plain `Error` keeps today's behaviour exactly. The
 * tidier rule — retry 5xx/408/429 and nothing else — would have been a silent
 * behaviour change across every dashboard query in service of a defect
 * measured on one admin path, and the owner ruled against it on 2026-08-22.
 *
 * Mutations need no equivalent: TanStack Query defaults them to `retry: 0`.
 */

/**
 * Retries before giving up, matching the library default this replaces.
 *
 * Stated rather than inherited: the point of the change is *which* failures
 * retry, and silently altering *how many* at the same time would make a
 * regression here impossible to attribute.
 */
export const MAX_QUERY_RETRIES = 3;

/**
 * Whether re-sending this request can plausibly produce a different answer.
 *
 * `408 Request Timeout` and `429 Too Many Requests` are the two 4xx that a
 * retry is the correct response to — both say "not now" rather than "no". Every
 * other 4xx is a statement about the request itself: a 403 will refuse the same
 * caller again, a 404 will not find the row, a 400 will reject the same body.
 *
 * 5xx is excluded on purpose. A 500 may well be transient, and retrying it is
 * the behaviour this change is careful not to disturb.
 */
export function isNonRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) {
    return false;
  }
  return status >= 400 && status < 500;
}

/**
 * The `defaultOptions.queries.retry` predicate.
 *
 * `failureCount` is the number of failures **before** this one — it is `0` when
 * the first attempt fails. Checked against the library rather than assumed:
 * `@tanstack/query-core@5.100.5` `retryer.js` reads `failureCount` at line 89
 * and increments it at line 94. So `>= MAX_QUERY_RETRIES` permits three
 * retries and four requests in total, which is exactly what the `retry: 3`
 * default did — and four is the number measured on the running stack.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) {
    return false;
  }
  if (error instanceof ApiError && isNonRetryableStatus(error.status)) {
    return false;
  }
  return true;
}
