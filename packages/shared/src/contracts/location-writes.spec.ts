import { expect } from "vitest";

import {
  FT2_TO_M2,
  createLocationBodySchema,
  floorAreaM2Of,
  updateLocationBodySchema,
} from "./location-writes";

/**
 * `E4.1b` review C1 (pre-existing) — the location form sends `null` for an
 * empty Province / Capital (`locations-page.tsx`: `form.capital || null`),
 * and the body schema refused it: measured over HTTP, `PATCH { capital: null }`
 * → 400 "Expected string, received null", so every PHE location (seeded
 * `capital: null`) could not be saved from the form. Pure schema cases, no
 * database; the write path is `locations.timezone.integration.spec.ts` T8.
 */

const CREATE_BASE = {
  organizationId: "33333333-3333-3333-3333-333333333333",
  code: "E41B-C1",
  slug: "e41b-c1",
  name: "C1 schema case",
  type: "rsmoc" as const,
  latitude: 0,
  longitude: 0,
};

/** S1 — an update body with `capital: null` parses. */
export function updateAdmitsNullCapital(): void {
  const parsed = updateLocationBodySchema.safeParse({ capital: null });
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
}

/** S2 — a create body with `province: null` parses (the form's empty-field shape). */
export function createAdmitsNullProvince(): void {
  const parsed = createLocationBodySchema.safeParse({ ...CREATE_BASE, province: null });
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
}

/**
 * C5 (`F4.157`, ADR 0077 D1) — `type` is no longer a closed three-value enum;
 * `pump_station`, the fourth `bms.location_types` row, must parse.
 */
export function createAdmitsPumpStationType(): void {
  const parsed = createLocationBodySchema.safeParse({ ...CREATE_BASE, type: "pump_station" });
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
}

const PARENT_UUID = "44444444-4444-4444-4444-444444444444";

/** P1 (`F2.10`) — a create body admits a uuid parent, null (a root) and an absent key. */
export function createAdmitsParentId(): void {
  for (const parentId of [PARENT_UUID, null, undefined]) {
    const body = parentId === undefined ? CREATE_BASE : { ...CREATE_BASE, parentId };
    const parsed = createLocationBodySchema.safeParse(body);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  }
}

/** P2 — a create body refuses a parentId that is not a uuid. */
export function createRefusesNonUuidParentId(): void {
  expect(createLocationBodySchema.safeParse({ ...CREATE_BASE, parentId: "not-a-uuid" }).success).toBe(false);
}

/** P3 — an update body is the move: `{ parentId: null }` alone parses (inherited via omit().partial()). */
export function updateAdmitsParentIdAlone(): void {
  const parsed = updateLocationBodySchema.safeParse({ parentId: null });
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  expect(updateLocationBodySchema.safeParse({ parentId: PARENT_UUID }).success).toBe(true);
}

// F4.304 (ADR 0108 Amendment 5 item 3) — floorArea { value, unit }.

type Which = "create" | "update";

function parseFloorArea(which: Which, floorArea: unknown) {
  return which === "create"
    ? createLocationBodySchema.safeParse({ ...CREATE_BASE, floorArea })
    : updateLocationBodySchema.safeParse({ floorArea });
}

function issuePaths(which: Which, floorArea: unknown): string[] {
  const parsed = parseFloorArea(which, floorArea);
  expect(parsed.success).toBe(false);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join("."));
}

/** F1 — the ft² constant is exactly 0.09290304. */
export function ft2ConstantIsExact(): void {
  expect(FT2_TO_M2).toBe(0.09290304);
}

/** F2 — 1000 ft² is 92.90304 m². */
export function thousandSquareFeet(): void {
  expect(floorAreaM2Of({ value: 1000, unit: "ft2" })).toBe(92.90304);
}

/** F3 — a value in m² is stored as typed. */
export function squareMetresUnchanged(): void {
  expect(floorAreaM2Of({ value: 120, unit: "m2" })).toBe(120);
}

/** F4 — create admits a value alone, and the parse carries unit m2. */
export function createDefaultsUnitToM2(): void {
  const parsed = createLocationBodySchema.safeParse({ ...CREATE_BASE, floorArea: { value: 120 } });
  expect(parsed.success).toBe(true);
  expect(parsed.success ? parsed.data.floorArea : undefined).toEqual({ value: 120, unit: "m2" });
}

/** F5 — create admits ft2. */
export function createAdmitsFt2(): void {
  expect(parseFloorArea("create", { value: 1, unit: "ft2" }).success).toBe(true);
}

/** F6 — create admits null. */
export function createAdmitsNullFloorArea(): void {
  expect(parseFloorArea("create", null).success).toBe(true);
}

/** F7 — update admits a floorArea alone. */
export function updateAdmitsFloorAreaAlone(): void {
  expect(parseFloorArea("update", { value: 5 }).success).toBe(true);
}

/** The refusals: [label, bad value, the issue path that must fire]. */
export const FLOOR_AREA_REFUSALS: ReadonlyArray<readonly [string, unknown, string]> = [
  ["value 0", { value: 0 }, "floorArea.value"],
  ["value 0.5", { value: 0.5 }, "floorArea.value"],
  ["value 100000001", { value: 100_000_001 }, "floorArea.value"],
  ["value NaN", { value: Number.NaN }, "floorArea.value"],
  ["value as a string", { value: "12" }, "floorArea.value"],
  ["unit sqft", { value: 1, unit: "sqft" }, "floorArea.unit"],
  ["an extra key", { value: 1, note: "x" }, "floorArea"],
];

/** R — one refusal, naming the guard that fired. */
export function refuses(which: Which, bad: unknown, path: string): void {
  expect(issuePaths(which, bad)).toContain(path);
}
