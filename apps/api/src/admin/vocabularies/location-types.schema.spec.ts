import { expect } from "vitest";

import { CATALOG_CODE_MESSAGE } from "@bms/shared";

import {
  createLocationTypeBodySchema,
  LOCATION_TYPE_CODE_MESSAGE,
  updateLocationTypeBodySchema,
} from "./location-types.schema";

/**
 * `F4.162` (ADR 0077 Amendment 1, plan U2 S1–S7b) — the request bodies of the
 * global-admin location-type write path. No database: every claim here is a
 * parse.
 *
 * One claim per exported function, each named after the plan case whose
 * mutation must redden it.
 */

/** The messages of every issue a failed parse reports at `path`. */
function messagesAt(result: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }, path: string): string[] {
  expect(result.success, "the parse was expected to fail").toBe(false);
  return (result.error?.issues ?? [])
    .filter((issue) => issue.path.join(".") === path)
    .map((issue) => issue.message);
}

/**
 * S1 — `"Pump Station"` is refused by the `F2.23` catalog class.
 *
 * Asserted on the MESSAGE, not on `.success`: the snake_case class is a strict
 * subset of `CATALOG_CODE_PATTERN`, so every code the catalog regex refuses the
 * snake_case regex refuses too, and `.success` alone could never show the
 * catalog regex was dropped. Zod 3 runs every string check and reports every
 * issue, so the catalog message is present exactly when that check ran.
 */
export function assertS1CreateRefusesASpaceWithTheCatalogMessage(): void {
  const result = createLocationTypeBodySchema.safeParse({ code: "Pump Station", label: "x" });
  expect(messagesAt(result, "code")).toContain(CATALOG_CODE_MESSAGE);
}

/**
 * S2 — a 33-character code is refused. `"a".repeat(33)` passes both regexes,
 * so the length bound is the only check that can refuse it.
 */
export function assertS2CreateRefusesA33CharacterCode(): void {
  const result = createLocationTypeBodySchema.safeParse({ code: "a".repeat(33), label: "x" });
  expect(result.success).toBe(false);
}

/** S3 — a PATCH body naming `code` is refused: `code` is the primary key. */
export function assertS3UpdateRefusesABodyNamingCode(): void {
  const result = updateLocationTypeBodySchema.safeParse({ code: "x", label: "y" });
  expect(result.success).toBe(false);
}

/** S4 — positive control: a label alone is a valid PATCH body. */
export function assertS4UpdateAcceptsALabelAlone(): void {
  const result = updateLocationTypeBodySchema.safeParse({ label: "Pumping stations" });
  expect(result.success).toBe(true);
}

/** S5 — a negative sort order is refused. */
export function assertS5CreateRefusesANegativeSortOrder(): void {
  const result = createLocationTypeBodySchema.safeParse({
    code: "pump_station",
    label: "x",
    sortOrder: -1,
  });
  expect(result.success).toBe(false);
}

/** S6 — a fractional sort order is refused. */
export function assertS6CreateRefusesAFractionalSortOrder(): void {
  const result = createLocationTypeBodySchema.safeParse({
    code: "pump_station",
    label: "x",
    sortOrder: 1.5,
  });
  expect(result.success).toBe(false);
}

/**
 * S7 — `"Pump_Station"` is refused (OQ1: lower snake_case). It is inside the
 * catalog class, so only the snake_case regex can refuse it.
 */
export function assertS7CreateRefusesAnUpperCaseCode(): void {
  const result = createLocationTypeBodySchema.safeParse({ code: "Pump_Station", label: "x" });
  expect(messagesAt(result, "code")).toEqual([LOCATION_TYPE_CODE_MESSAGE]);
}

/**
 * S7b — `"pump-station"` is refused. The catalog class admits `-`; the ruled
 * class does not, because the four seeded codes are snake_case.
 */
export function assertS7bCreateRefusesAHyphenatedCode(): void {
  const result = createLocationTypeBodySchema.safeParse({ code: "pump-station", label: "x" });
  expect(result.success).toBe(false);
}

/**
 * Positive control for S1–S7b: a code in the ruled class, with a label and a
 * sort order in range, parses. Without it every refusal above would pass on a
 * schema that refused everything.
 */
export function assertCreateAcceptsASnakeCaseCode(): void {
  const result = createLocationTypeBodySchema.safeParse({
    code: "pump_station_2",
    label: "Pump station 2",
    sortOrder: 40,
  });
  expect(result.success).toBe(true);
}
