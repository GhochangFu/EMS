import { expect } from "vitest";

import { createRtuBodySchema, updateRtuBodySchema } from "@bms/shared";
import type { AdminRtuDto } from "@bms/shared";

import {
  createRtuValues,
  emptyRtuForm,
  expectedIntervalChange,
  rtuFormOf,
  rtuFormWithValues,
  updateRtuValues,
} from "./rtu-wizards";

/**
 * `F4.350` (ADR 0075 Amendment 3) — the optional "Expected interval (s)" field of the RTU form: sent on create when
 * filled, sent on update only when it changed, and an emptied field clears it (`null`). Assertions live here; the
 * sibling `.test.ts` is the Vitest entry point (ADR 0014).
 */

const LOCATION = "11111111-1111-4111-8111-111111111111";

function row(expectedIntervalSeconds: number | null): AdminRtuDto {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    locationId: LOCATION,
    locationName: "Site",
    organizationCode: "ORG",
    code: "RTU-1",
    displayName: "RTU 1",
    sourceType: "mqtt",
    domain: null,
    externalRtuId: null,
    rtuCode: null,
    mqttTopic: null,
    releasedMqttTopic: null,
    expectedIntervalSeconds,
    stationCode: null,
    stationName: null,
    ingestEnabled: false,
    active: true,
    meta: null,
  } as unknown as AdminRtuDto;
}

/** E1 — a create carries the number when filled and nothing when empty. */
export function createSendsTheIntervalWhenFilled(): void {
  const filled = { ...emptyRtuForm(LOCATION), expectedIntervalSeconds: "60" };
  expect(createRtuValues(filled).expectedIntervalSeconds).toBe(60);
  expect(createRtuValues(emptyRtuForm(LOCATION)).expectedIntervalSeconds).toBeUndefined();
}

/** E2 — the edit form opens with the stored number as text, empty for null. */
export function theEditFormOpensWithTheStoredInterval(): void {
  expect(rtuFormOf(row(60)).expectedIntervalSeconds).toBe("60");
  expect(rtuFormOf(row(null)).expectedIntervalSeconds).toBe("");
}

/** E3 — an update sends the interval only when it changed; an emptied field clears it. */
export function updateSendsOnlyAChange(): void {
  expect(expectedIntervalChange("60", 60)).toBeUndefined();
  expect(expectedIntervalChange("90", 60)).toBe(90);
  expect(expectedIntervalChange("90", null)).toBe(90);
  expect(expectedIntervalChange("", null)).toBeUndefined();
  expect(expectedIntervalChange("", 60)).toBeNull();
  const edited = { ...rtuFormOf(row(60)), expectedIntervalSeconds: "" };
  expect(updateRtuValues(edited, row(60)).expectedIntervalSeconds).toBeNull();
}

/** E4 — the write bodies accept a whole number of seconds, `null` to clear on update, and refuse 0, a fraction and a day-plus. */
export function theWriteBodiesBoundTheInterval(): void {
  const base = { locationId: LOCATION, code: "RTU-1", displayName: "RTU 1" };
  expect(createRtuBodySchema.safeParse({ ...base, expectedIntervalSeconds: 60 }).success).toBe(true);
  for (const bad of [0, -1, 1.5, 86_401, "60"]) {
    expect(createRtuBodySchema.safeParse({ ...base, expectedIntervalSeconds: bad }).success, String(bad)).toBe(false);
  }
  expect(updateRtuBodySchema.safeParse({ expectedIntervalSeconds: null }).success).toBe(true);
  expect(updateRtuBodySchema.safeParse({}).success).toBe(true);
}

/** E5 — a copilot fill sets the field from a number, empties it on `null`, and leaves it alone when the fill omits it. */
export function aCopilotFillReachesTheField(): void {
  const form = { ...emptyRtuForm(LOCATION), expectedIntervalSeconds: "45" };
  expect(rtuFormWithValues(form, { expectedIntervalSeconds: 60 }).expectedIntervalSeconds).toBe("60");
  expect(rtuFormWithValues(form, { expectedIntervalSeconds: null }).expectedIntervalSeconds).toBe("");
  expect(rtuFormWithValues(form, { code: "X" }).expectedIntervalSeconds).toBe("45");
}
