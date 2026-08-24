import { expect } from "vitest";

import { buildRolePasswordStatements } from "./roles";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

export function assertOneEntryPerRoleWhenAllThreeAreSet(): void {
  expect(
    buildRolePasswordStatements({
      BMS_TENANT_PASSWORD: "t",
      BMS_FLEET_PASSWORD: "f",
      BMS_AUTH_PASSWORD: "a",
    }),
  ).toEqual([
    { role: "bms_tenant", password: "t" },
    { role: "bms_fleet", password: "f" },
    { role: "bms_auth", password: "a" },
  ]);
}

export function assertNamesEveryMissingVariableAtOnce(): void {
  expect(() => buildRolePasswordStatements({ BMS_FLEET_PASSWORD: "f" })).toThrow(
    "BMS_TENANT_PASSWORD, BMS_AUTH_PASSWORD",
  );
}

export function assertRefusesAnEmptyPassword(): void {
  expect(() =>
    buildRolePasswordStatements({
      BMS_TENANT_PASSWORD: "",
      BMS_FLEET_PASSWORD: "f",
      BMS_AUTH_PASSWORD: "a",
    }),
  ).toThrow("BMS_TENANT_PASSWORD");
}
