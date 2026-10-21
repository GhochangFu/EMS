import { BadRequestException, type HttpException, NotFoundException, PreconditionFailedException } from "@nestjs/common";
import { type AnyColumn, type SQL, sql } from "drizzle-orm";

import { type IfMatch, ifMatchHeaderSchema, PRECONDITION_STALE_MESSAGE } from "@bms/shared";

/**
 * `F4.247` / ADR 0099 Amendment 5 C3 — the `If-Match` precondition of the two list writes
 * (`PUT /dashboards/:id/widgets`, `PATCH /admin/asset-templates/:id`), shared so the two routes
 * cannot drift.
 *
 * The header names the record DTO's `updatedAt` in quotes; it is not the response's `ETag`.
 */

/**
 * The controller half: the raw `@Headers("if-match")` value to the branded instant, or
 * `undefined` when the request sent none. A weak tag, `*`, a list or a non-instant is the
 * route's 400, in the repo's `flatten()` shape. `safeParse`, so no `ZodError` leaves here.
 */
export function parseIfMatchHeader(raw: string | undefined): IfMatch | undefined {
  if (raw === undefined) return undefined;
  const parsed = ifMatchHeaderSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}

/**
 * The write's extra predicate: the row's `updated_at` rendered **as text** in the DTO's shape
 * equals the header. Text, never a `::timestamptz` cast of the header, so a value the schema
 * passes and Postgres cannot cast (the year 0000) misses the row (412) instead of answering 500.
 * `to_char`'s `MS` truncates microseconds as the API's `Date` does, so a fresh row matches the
 * `updatedAt` it was served with. `undefined` (no header): no compare — `and()` drops it.
 */
export function updatedAtMatches(column: AnyColumn, ifMatch: IfMatch | undefined): SQL | undefined {
  if (ifMatch === undefined) return undefined;
  return sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = ${ifMatch}`;
}

/**
 * The refusal when the conditional write touched no row: **412 only when `If-Match` was sent**
 * (the record changed, or went, since it was read). Without the header no precondition failed —
 * the row went between the route's read and its write — so it is the route's own 404.
 */
export function noRowWritten(ifMatch: IfMatch | undefined, notFoundMessage: string): HttpException {
  return ifMatch === undefined
    ? new NotFoundException(notFoundMessage)
    : new PreconditionFailedException(PRECONDITION_STALE_MESSAGE);
}
