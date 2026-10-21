import { expect } from "vitest";

import { copilotPendingChangeDtoSchema } from "./copilot";
import { ifMatchHeaderSchema } from "./if-match";

/**
 * `F4.247` / ADR 0099 Amendment 5 — the `If-Match` header the two list writes take, and the
 * pending change's `ifMatch`. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const INSTANT = "2026-10-20T10:00:00.000Z";

/** Mutation: drop the `.transform(...)` that strips the quotes — the quoted value comes back. */
export function aQuotedInstantParsesToTheBareInstant(): void {
  expect(ifMatchHeaderSchema.parse(`"${INSTANT}"`)).toBe(INSTANT);
}

/** Mutation: regex `^(W\/)?"…"$` — a weak tag parses. */
export function aWeakTagIsRefused(): void {
  expect(ifMatchHeaderSchema.safeParse(`W/"${INSTANT}"`).success).toBe(false);
}

export function aStarIsRefused(): void {
  expect(ifMatchHeaderSchema.safeParse("*").success).toBe(false);
}

/** Mutation: regex `^"?[^"]*"?$` — the unquoted instant parses. */
export function anUnquotedInstantIsRefused(): void {
  expect(ifMatchHeaderSchema.safeParse(INSTANT).success).toBe(false);
}

/** Mutation: drop the `.pipe(...)` — a quoted non-instant parses. */
export function aQuotedNonInstantIsRefused(): void {
  expect(ifMatchHeaderSchema.safeParse('"abc"').success).toBe(false);
}

/** Mutation: drop `{ precision: 3 }` — an instant without milliseconds parses. */
export function anInstantWithoutMillisecondsIsRefused(): void {
  expect(ifMatchHeaderSchema.safeParse('"2026-10-20T10:00:00Z"').success).toBe(false);
}

/** Critique C12: a list of tags is one malformed value. Mutation: regex `^"[^]*"$` — the list parses into a non-instant. */
export function aListOfTagsIsRefused(): void {
  expect(ifMatchHeaderSchema.safeParse(`"${INSTANT}", "${INSTANT}"`).success).toBe(false);
}

const DTO = {
  id: "c1",
  catalogId: "dashboard.widgets.replace",
  method: "PUT",
  path: "/api/v1/dashboards/d1/widgets",
  body: {},
  summary: "s",
  risk: "edit",
  proposedAt: INSTANT,
  expiresAt: INSTANT,
  ifMatch: null,
} as const;

/** Mutation: `ifMatch: z.string().nullable().optional()` — a DTO without it parses. */
export function aPendingChangeWithoutIfMatchIsRefused(): void {
  const { ifMatch: _ifMatch, ...withoutIt } = DTO;
  expect(copilotPendingChangeDtoSchema.safeParse(withoutIt).success).toBe(false);
}

/** Adjacent positive: a DTO with a null or a string `ifMatch` parses. */
export function aPendingChangeCarriesItsIfMatch(): void {
  expect(copilotPendingChangeDtoSchema.parse(DTO).ifMatch).toBeNull();
  expect(copilotPendingChangeDtoSchema.parse({ ...DTO, ifMatch: INSTANT }).ifMatch).toBe(INSTANT);
}
