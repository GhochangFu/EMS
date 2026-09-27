import { adminLocationTypeDtoSchema, locationTypeCodeSchema } from "./location-types";
import { adminLocationTypesListResponseSchema } from "./envelopes";

/**
 * `F4.157` / ADR 0077 D1 — the one code schema every location-type-shaped
 * field now imports, replacing the closed `z.enum(["smoc_campus", "rsmoc",
 * "csmoc"])` literal.
 *
 * Assertions live here; `location-types.test.ts` is the vitest entry point
 * (ADR 0014). Everything below is a plain object and needs no connection.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** C1 — a live code parses; an empty string and a 33-character code are refused. */
export function runLocationTypeCodeBoundsTests(): void {
  assert(
    locationTypeCodeSchema.safeParse("pump_station").success === true,
    "pump_station — expected success, got a refusal",
  );
  assert(
    locationTypeCodeSchema.safeParse("").success === false,
    "an empty string — expected a refusal, got success",
  );
  assert(
    locationTypeCodeSchema.safeParse("x".repeat(33)).success === false,
    "a 33-character code — expected a refusal, got success",
  );
  assert(
    locationTypeCodeSchema.safeParse("x".repeat(32)).success === true,
    "a 32-character code (the column width) — expected success, got a refusal",
  );
}

const validAdminLocationType = {
  code: "pump_station",
  label: "Pump station",
  sortOrder: 40,
  active: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  locationCount: 6,
};

/**
 * `F4.162` C7 (ADR 0077 Amendment 1, D3) — `adminLocationTypeDtoSchema`
 * refuses a row without `locationCount`. Mutation: make the field
 * `.optional()`.
 */
export function runAdminLocationTypeDtoRequiresLocationCountTest(): void {
  assert(
    adminLocationTypeDtoSchema.safeParse(validAdminLocationType).success === true,
    "a full row carrying locationCount — expected success, got a refusal",
  );
  const { locationCount: _locationCount, ...withoutLocationCount } = validAdminLocationType;
  assert(
    adminLocationTypeDtoSchema.safeParse(withoutLocationCount).success === false,
    "a row missing locationCount — expected a refusal, got success",
  );
}

/**
 * `F4.162` C8 — `adminLocationTypeDtoSchema` refuses a negative
 * `locationCount`. Mutation: drop `.nonnegative()`.
 */
export function runAdminLocationTypeDtoRefusesNegativeLocationCountTest(): void {
  assert(
    adminLocationTypeDtoSchema.safeParse({ ...validAdminLocationType, locationCount: -1 }).success ===
      false,
    "locationCount: -1 — expected a refusal, got success",
  );
}

/**
 * `F4.162` C9 — `adminLocationTypesListResponseSchema` parses `{ items: [<full row>] }`.
 * Positive control.
 */
export function runAdminLocationTypesListResponseParsesTest(): void {
  assert(
    adminLocationTypesListResponseSchema.safeParse({ items: [validAdminLocationType] }).success ===
      true,
    "{ items: [<full row>] } — expected success, got a refusal",
  );
}
