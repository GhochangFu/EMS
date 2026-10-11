import { expect } from "vitest";

import { adminOrganizationDtoSchema } from "@bms/shared";

import {
  createOrganizationBodySchema,
  isValidOrganizationTimeZone,
  updateOrganizationBodySchema,
} from "./organizations.schema";

/**
 * `F3.85` / ADR 0099 A2 — `organizations.timezone` on the request schemas and
 * the shared DTO contract. Pure: no database. Assertions live here; the
 * sibling `.test.ts` carries the `it()`s (ADR 0014).
 */

const VALID_CREATE = { code: "TZ-SPEC", name: "Timezone spec", currency: "INR" };

/** Z1 — a region/city zone passes on create and on update. */
export function aRegionZonePasses(): void {
  expect(createOrganizationBodySchema.safeParse({ ...VALID_CREATE, timezone: "Asia/Kolkata" }).success).toBe(true);
  expect(createOrganizationBodySchema.safeParse({ ...VALID_CREATE, timezone: "Africa/Johannesburg" }).success).toBe(
    true,
  );
  expect(updateOrganizationBodySchema.safeParse({ timezone: "Asia/Kolkata" }).success).toBe(true);
}

/**
 * Z2 — `UTC` passes. `isValidTimeZone` refuses every slash-less name and
 * `Intl.supportedValuesOf("timeZone")` omits `UTC`, so the schema accepts it
 * explicitly; the negative control `EST` shows the slash-less refusal still holds.
 */
export function utcPasses(): void {
  expect(createOrganizationBodySchema.safeParse({ ...VALID_CREATE, timezone: "UTC" }).success).toBe(true);
  expect(updateOrganizationBodySchema.safeParse({ timezone: "UTC" }).success).toBe(true);
  expect(isValidOrganizationTimeZone("UTC")).toBe(true);
  expect(isValidOrganizationTimeZone("EST"), "a slash-less abbreviation is still refused").toBe(false);
  expect(isValidOrganizationTimeZone("utc"), "UTC is exact, case-sensitive").toBe(false);
}

/** Z3 — an unknown, mis-cased or empty zone is a ZodError on the `timezone` path (a 400 at the controller). */
export function anInvalidZoneIsRefused(): void {
  for (const bad of ["Mars/Olympus", "asia/kolkata", "", "Asia/Kolkata ", "Not A Zone"]) {
    const create = createOrganizationBodySchema.safeParse({ ...VALID_CREATE, timezone: bad });
    expect(create.success, `create with "${bad}"`).toBe(false);
    expect(!create.success && create.error.issues.map((i) => i.path.join("."))).toContain("timezone");
    expect(updateOrganizationBodySchema.safeParse({ timezone: bad }).success, `update with "${bad}"`).toBe(false);
  }
}

/** Z4 — the key stays optional on create (the column default applies) and on update. */
export function theKeyIsOptional(): void {
  const create = createOrganizationBodySchema.parse(VALID_CREATE);
  expect(create.timezone).toBeUndefined();
  expect(updateOrganizationBodySchema.parse({ name: "Renamed org" }).timezone).toBeUndefined();
}

/** Z5 — the shared DTO contract requires `timezone`: a DTO without it is refused, one with it parses. */
export function theDtoContractRequiresTimezone(): void {
  const dto = {
    id: "11111111-1111-1111-1111-111111111111",
    code: "TZ-SPEC",
    name: "Timezone spec",
    active: true,
    currency: "INR",
    timezone: "Asia/Kolkata",
    meta: null,
    createdAt: new Date(0).toISOString(),
  };
  const ok = adminOrganizationDtoSchema.safeParse(dto);
  expect(ok.success && ok.data.timezone).toBe("Asia/Kolkata");
  const { timezone: _omitted, ...without } = dto;
  expect(adminOrganizationDtoSchema.safeParse(without).success).toBe(false);
}
