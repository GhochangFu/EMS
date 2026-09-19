import { expect } from "vitest";

import { createLocationBodySchema, updateLocationBodySchema } from "./locations.schema";

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
