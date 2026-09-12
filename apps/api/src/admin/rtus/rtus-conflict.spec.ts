import { ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import { RTU_CODE_TAKEN_MESSAGE, translateRtuCodeCollision } from "./rtus-conflict";

/**
 * `F4.60` — assertions for the `rtus_rtu_code_idx` translation (ADR 0014: the
 * assertions live here, the Vitest blocks live in the sibling `.test.ts`).
 *
 * Pure-function claims only. That the driver actually raises `23505` with this
 * constraint name, that a rollback preserves the object, and that `update`
 * restating an unchanged `rtu_code` does not self-collide are database
 * behaviours, and they are gated in `rtus.rtu-code-conflict.integration.spec.ts`.
 */

/**
 * The constraint name as an **independent literal**, deliberately not imported
 * from the module under test.
 *
 * The plan predicted that renaming the constant to `rtus_rtucode_idx` would keep
 * this spec green and be caught only at the integration layer. That is true of a
 * spec that derives the name from the implementation, and it is exactly why this
 * one does not: the name is a contract with migration `0071`, so the spec states
 * it the same way `onboarding-commit-conflict.spec.ts` states its ten — as a
 * string at the call site.
 */
const LIVE_INDEX_NAME = "rtus_rtu_code_idx";

type DriverErrorFields = {
  code?: string;
  constraint?: string;
  table?: string;
  schema?: string;
  detail?: string;
};

/**
 * A `node-postgres` 8.20 unique violation, in the shape
 * `onboarding-commit-conflict.spec.ts`'s own `pgUniqueViolation` builds.
 *
 * The default `detail` is **more than the production path can produce** — see
 * the module docblock's two-role probe: under `bms_tenant` and `bms_owner` a
 * real duplicate `rtu_code` carries no `DETAIL` at all. A pure function must not
 * be excused by the server having withheld its input, so the field is supplied
 * here on purpose.
 */
function pgUniqueViolation(constraint: string, overrides: DriverErrorFields = {}): unknown {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
    table: "rtus",
    schema: "bms",
    detail: "Key (rtu_code)=(f4.60-dcode) already exists.",
    ...overrides,
  });
}

/**
 * The mapped case: a `23505` naming this index becomes the ruled 409.
 *
 * `toBe` on the message rather than `toContain`, so appending a sentence to the
 * refusal — the way a leak arrives — reddens this.
 */
export function assertADuplicateRtuCodeBecomesTheRuledConflict(): void {
  const translated = translateRtuCodeCollision(pgUniqueViolation(LIVE_INDEX_NAME));
  expect(translated).toBeInstanceOf(ConflictException);
  expect((translated as ConflictException).message).toBe(RTU_CODE_TAKEN_MESSAGE);
}

/**
 * Another constraint's `23505` is returned **unchanged**, by identity.
 *
 * `assets_code_unique` is not hypothetical: `AssetTemplatesInstantiateService`
 * translates it into its own 409, and `onboarding-commit-conflict.ts` into a
 * 400. If this function claimed it too, whichever route ran last would decide
 * what an asset-code collision says.
 *
 * `toBe`, not `toEqual` — the point is that the original object survives with
 * its stack and its `cause`, which a structurally equal copy would not prove.
 */
export function assertAnotherConstraintsDuplicateIsReturnedUnchanged(): void {
  const err = pgUniqueViolation("assets_code_unique");
  expect(translateRtuCodeCollision(err)).toBe(err);
}

/**
 * The second axis: the index name on a **foreign-key** violation is not a
 * duplicate.
 *
 * `23503` sets `constraint` too. `translateAssetCodeCollision` branches on the
 * name alone and would call this a taken `rtuCode`; this function tests the
 * SQLSTATE as well, and that difference is the whole reason for the narrower
 * shape. Contrived as a driver error — Postgres does not name a unique index on
 * a `23503` — and that is the point: the guard must hold on the input, not on a
 * belief about what the server sends.
 */
export function assertAForeignKeyViolationNamingTheIndexIsReturnedUnchanged(): void {
  const err = pgUniqueViolation(LIVE_INDEX_NAME, { code: "23503" });
  expect(translateRtuCodeCollision(err)).toBe(err);
}

/**
 * A non-object rejection survives.
 *
 * `undefined` and a bare string are what a dropped connection, an `abort` or a
 * `throw "boom"` upstream can put through the same `.catch`. Narrowing that read
 * `err.code` off a primitive would throw a `TypeError` from inside the error
 * path and replace a real failure with a confusing one.
 */
export function assertANonObjectRejectionIsReturnedUnchanged(): void {
  expect(translateRtuCodeCollision(undefined)).toBe(undefined);
  expect(translateRtuCodeCollision("boom")).toBe("boom");
}

/**
 * §4.3 — nothing the driver supplied reaches the client.
 *
 * `detail` is the dangerous field: it echoes the value the caller sent, which on
 * a fleet-wide index is equal to one in a row the caller may not be allowed to
 * know exists.
 *
 * **The first expectation is the positive control and it is not decoration.**
 * `JSON.stringify` of an `HttpException` depends on which properties are own and
 * enumerable; if it rendered `{}` the two absence checks below would pass
 * against an implementation that spliced `err.detail` straight into the
 * sentence. Proving the refusal's own words are in the serialised form first is
 * what makes their absence mean something.
 */
export function assertNothingFromTheDriverErrorReachesTheClient(): void {
  const translated = translateRtuCodeCollision(
    pgUniqueViolation(LIVE_INDEX_NAME, {
      detail: "Key (rtu_code)=(F460SENTINEL) already exists.",
    }),
  );
  const exception = translated as ConflictException;
  // The body Nest writes, plus the exception's own message — the two surfaces a
  // splice would land on. `stack` is deliberately excluded: it never reaches the
  // client, and its file paths would make the `detail` scan answer about the
  // wrong thing.
  const wire = JSON.stringify({
    response: exception.getResponse(),
    message: exception.message,
  });
  expect(wire).toContain("already taken");
  expect(wire).not.toContain("F460SENTINEL");
  expect(wire).not.toContain("detail");
}

/**
 * The words `onboarding-commit-conflict.spec.ts` forbids a fleet-wide refusal
 * from using.
 *
 * **Restated, not imported** — the original `CROSS_TENANT_LOCUS_WORDS`
 * in `onboarding-commit-conflict.spec.ts` is a module-private `const`, and that
 * file belongs to another unit in flight, so exporting it is not this unit's
 * edit to make. Copied verbatim from that list on 2026-09-12; if the two drift,
 * the original is the authority.
 */
const CROSS_TENANT_LOCUS_WORDS = [
  "another",
  "other",
  "elsewhere",
  "tenant",
  "organization",
  "organisation",
  "someone else",
  "site",
  "owner",
  "customer",
  "belongs",
];

/**
 * The refusal does not say where the taken row lives.
 *
 * `rtus_rtu_code_idx` has no `organization_id` in its key, so it refuses across
 * organizations. "That rtuCode is already taken" is what such a caller may be
 * told; naming a second tenant — even anonymously — turns a duplicate into the
 * disclosure that one exists.
 *
 * **Named for what it measures.** The mutation it catches is a message that says
 * "already used in another organization"; what reddens is a word match, so a
 * phrasing that leaks the same inference in other words is not covered. The
 * semantic rule is held by review. Do not read a green run here as that rule
 * having been checked.
 */
export function assertTheRefusalNamesNoOtherTenant(): void {
  const translated = translateRtuCodeCollision(pgUniqueViolation(LIVE_INDEX_NAME));
  const body = (translated as ConflictException).message.toLowerCase();
  // The positive control: a message that had been emptied would pass the scan.
  expect(body).toContain("rtucode");
  const leaks = CROSS_TENANT_LOCUS_WORDS.filter((word) => body.includes(word));
  expect(leaks).toEqual([]);
}
