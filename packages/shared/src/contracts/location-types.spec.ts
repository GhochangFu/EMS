import { locationTypeCodeSchema } from "./location-types";

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
