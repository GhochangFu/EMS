import { expect } from "vitest";

import { REQUEST_SCHEMAS } from "../../openapi/openapi-registry";
import { STRICTNESS_LEDGER } from "../../testing/strict-body-ledger.data";
import { createPointKeyBodySchema, updatePointKeyBodySchema } from "./point-keys.schema";

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
 * No new body, so no new registry or ledger row (plan "Measured
 * conventions"). Asserted by identity, not by text: the registry must still
 * hand the OpenAPI document these exact schema objects, so the new field
 * reaches the document with no second edit.
 */
export function registryAndLedgerStillNameTheBodies(): void {
  expect(REQUEST_SCHEMAS.PointKeysAdminController_create).toBe(createPointKeyBodySchema);
  expect(REQUEST_SCHEMAS.PointKeysAdminController_update).toBe(updatePointKeyBodySchema);
  expect(STRICTNESS_LEDGER.createPointKeyBodySchema).toBeDefined();
  expect(STRICTNESS_LEDGER.updatePointKeyBodySchema).toBeDefined();
}
