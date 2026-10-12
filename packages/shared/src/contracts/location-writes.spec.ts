import { expect } from "vitest";

import { createLocationBodySchema, updateLocationBodySchema } from "./location-writes";

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
