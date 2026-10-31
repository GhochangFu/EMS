import { expect } from "vitest";

import { adminPointKeyDtoSchema } from "./point-keys";
import { createPointKeyBodySchema, updatePointKeyBodySchema } from "./point-key-writes";

/**
 * `F3.68` / ADR 0076 decision 7 — `headlineRank` on the point-key admin
 * bodies (plan U3, B1–B4). The field sits on the create body, so the update
 * body (`omit({ code }).partial()`) inherits it; both stay `.strict()`.
 *
 * The range is the column's: `smallint` tops out at 32767, and migration
 * `0083`'s CHECK refuses anything below 1. `null` clears a rank (plan D1:
 * NULL = unranked).
 */

/** B1 — a rank of 0 is refused at `[headlineRank]`, on both bodies. */
export function refusesAZeroRank(): void {
  const update = updatePointKeyBodySchema.safeParse({ headlineRank: 0 });
  expect(update.success, "PATCH { headlineRank: 0 } must be refused").toBe(false);
  expect(update.error?.issues.map((i) => i.path.join("."))).toEqual(["headlineRank"]);

  const create = createPointKeyBodySchema.safeParse({ code: "kw", name: "kW", headlineRank: 0 });
  expect(create.success, "POST { headlineRank: 0 } must be refused").toBe(false);
}

/** B1b — the smallint ceiling: 32768 is refused, 32767 is accepted. */
export function refusesARankAboveSmallint(): void {
  expect(updatePointKeyBodySchema.safeParse({ headlineRank: 32768 }).success).toBe(false);
  expect(updatePointKeyBodySchema.safeParse({ headlineRank: 32767 }).success).toBe(true);
}

/** B1c — a fractional rank is refused. */
export function refusesAFractionalRank(): void {
  expect(updatePointKeyBodySchema.safeParse({ headlineRank: 1.5 }).success).toBe(false);
}

/** B2 — `null` is accepted and kept as `null`: that is how a rank is cleared. */
export function acceptsANullRank(): void {
  const parsed = updatePointKeyBodySchema.parse({ headlineRank: null });
  expect(parsed).toEqual({ headlineRank: null });
}

/** B3 — a positive whole rank is accepted on both bodies. */
export function acceptsARankOfTwo(): void {
  expect(updatePointKeyBodySchema.parse({ headlineRank: 2 })).toEqual({ headlineRank: 2 });
  expect(
    createPointKeyBodySchema.parse({ code: "kw", name: "kW", headlineRank: 2 }).headlineRank,
  ).toBe(2);
}

/** B3b — the field is optional: a body without it still parses. */
export function acceptsABodyWithoutARank(): void {
  expect(updatePointKeyBodySchema.parse({ name: "renamed" })).toEqual({ name: "renamed" });
}

/** B4 — `.strict()` survives: an unknown key is still refused. */
export function stillRefusesAnUnknownKey(): void {
  const update = updatePointKeyBodySchema.safeParse({ headlineRank: 2, organizationId: "x" });
  expect(update.success, "PATCH with an unknown key must be refused").toBe(false);
  expect(update.error?.issues[0]?.code).toBe("unrecognized_keys");
}

/**
 * `F4.300` / ADR 0108 decision 3 — `trendDefault` on the point-key admin
 * bodies and the admin DTO (plan U1, T1–T3).
 */

/** T1 — the create body accepts a boolean flag and refuses a string. */
export function createBodyTakesABooleanTrendDefault(): void {
  expect(
    createPointKeyBodySchema.parse({ code: "kw", name: "kW", trendDefault: true }).trendDefault,
  ).toBe(true);
  expect(
    createPointKeyBodySchema.safeParse({ code: "kw", name: "kW", trendDefault: "yes" }).success,
  ).toBe(false);
}

/** T2 — the update body accepts `{ trendDefault: false }` alone (a decided false). */
export function updateBodyTakesTrendDefaultAlone(): void {
  expect(updatePointKeyBodySchema.parse({ trendDefault: false })).toEqual({ trendDefault: false });
}

/** T3 — the admin DTO requires the field, so a producer that forgets it fails. */
export function dtoRequiresTrendDefault(): void {
  const dto = {
    id: "i",
    code: "kw",
    name: "kW",
    domain: null,
    unit: null,
    description: null,
    active: true,
    createdAt: "2026-10-31T00:00:00.000Z",
    headlineRank: null,
  };
  expect(adminPointKeyDtoSchema.safeParse(dto).success).toBe(false);
  expect(adminPointKeyDtoSchema.safeParse({ ...dto, trendDefault: false }).success).toBe(true);
}
