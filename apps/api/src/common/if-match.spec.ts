import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BadRequestException, NotFoundException, PreconditionFailedException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect } from "vitest";

import { dashboards } from "@bms/db";
import { type IfMatch, PRECONDITION_STALE_MESSAGE } from "@bms/shared";

import { repoRoot } from "../testing/repo-root";
import { noRowWritten, parseIfMatchHeader, updatedAtMatches } from "./if-match";

/**
 * `F4.247` / ADR 0099 Amendment 5 C3 — the `If-Match` helpers both list writes share, and the
 * `@Headers("if-match")` wiring of both controllers. The database half (the conditional write
 * applying, refusing, matching a microsecond stamp) is the two
 * `*.precondition.integration.spec.ts` files. Vitest entry point: the sibling `.test.ts`
 * (ADR 0014).
 */

const INSTANT = "2026-10-20T10:00:00.000Z" as IfMatch;

/** Mutation: return the raw header — a request with none must reach the service as `undefined`. */
export function noHeaderParsesToUndefined(): void {
  expect(parseIfMatchHeader(undefined)).toBeUndefined();
}

/** Mutation: skip the `safeParse` and return the raw value — the quotes reach the compare. */
export function aQuotedInstantParsesToTheBareInstant(): void {
  expect(parseIfMatchHeader(`"${INSTANT}"`)).toBe(INSTANT);
}

/** Mutation: return `undefined` on a parse failure — a weak tag writes with no compare. */
export function aMalformedHeaderIsA400(): void {
  expect(() => parseIfMatchHeader('W/"x"')).toThrow(BadRequestException);
}

/** Mutation: return `sql\`true\`` for no header — the compare would still run. */
export function noHeaderAddsNoPredicate(): void {
  expect(updatedAtMatches(dashboards.updatedAt, undefined)).toBeUndefined();
}

/**
 * Critique C1: the compare is text, so a schema-valid instant Postgres cannot cast (the year
 * 0000) misses the row instead of answering 500. Mutation:
 * `${column} = ${ifMatch}::timestamptz`.
 */
export function thePredicateComparesTheStampAsText(): void {
  const fragment = updatedAtMatches(dashboards.updatedAt, INSTANT);
  if (fragment === undefined) throw new Error("a sent If-Match must add a predicate");
  const query = new PgDialect().sqlToQuery(fragment);
  expect(query.sql).toMatch(/^to_char\(.*"updated_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\) = \$1$/);
  expect(query.sql).not.toMatch(/::\s*timestamp/i);
  expect(query.params).toEqual([INSTANT]);
}

/** Critique C2: no header, no precondition — a row gone between read and write is the route's 404. Mutation: always 412. */
export function noRowWithoutAHeaderIsTheRoutes404(): void {
  const err = noRowWritten(undefined, "Dashboard not found");
  expect(err).toBeInstanceOf(NotFoundException);
  expect(err.message).toBe("Dashboard not found");
}

/** Mutation: always 404 — a stale If-Match would read as a missing record. */
export function noRowWithAHeaderIsA412(): void {
  const err = noRowWritten(INSTANT, "Dashboard not found");
  expect(err).toBeInstanceOf(PreconditionFailedException);
  expect(err.message).toBe(PRECONDITION_STALE_MESSAGE);
}

/**
 * Critique C4: the decorator itself. The controller specs call the handler directly (`F4.20`:
 * esbuild emits no `design:paramtypes`, so no router runs in a unit test), so a missing or
 * misspelled `@Headers("if-match")` would leave the route seeing `undefined` — the copilot's
 * Confirm passes the interceptor and the route applies the stale body with no compare. Each
 * handler must take the header lowercase (Node lowercases incoming names) and pass it, parsed,
 * as the service call's last argument.
 */
const handlerText = (rel: string, start: string): string => {
  const source = readFileSync(join(repoRoot(), rel), "utf8");
  const from = source.indexOf(start);
  expect(from, `${rel} must declare ${start}`).toBeGreaterThan(-1);
  const to = source.indexOf("\n  }\n", from);
  expect(to, `${start} must close`).toBeGreaterThan(from);
  return source.slice(from, to);
};

const WIRED = /@Headers\("if-match"\) ifMatch\?: string,?\s*\)[\s\S]*parseIfMatchHeader\(ifMatch\),?\s*\);/;

/** Mutation: drop or misspell the decorator on `putWidgets`. */
export function thePutWidgetsHandlerTakesIfMatch(): void {
  expect(handlerText("apps/api/src/dashboard-builder/dashboard-builder.controller.ts", "async putWidgets(")).toMatch(WIRED);
}

/** Mutation: drop or misspell the decorator on the asset-template `update`. */
export function theAssetTemplateUpdateHandlerTakesIfMatch(): void {
  expect(handlerText("apps/api/src/admin/asset-templates/asset-templates.controller.ts", "async update(")).toMatch(WIRED);
}
