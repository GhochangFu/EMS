import { expect } from "vitest";

import { resolveDatabaseUrls } from "./database-urls";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

export function assertReturnsAllThreeWhenAllThreeAreSet(): void {
  expect(
    resolveDatabaseUrls({
      DATABASE_URL_AUTH: "postgres://bms_auth@h/db",
      DATABASE_URL_TENANT: "postgres://bms_tenant@h/db",
      DATABASE_URL_FLEET: "postgres://bms_fleet@h/db",
    }),
  ).toEqual({
    auth: "postgres://bms_auth@h/db",
    tenant: "postgres://bms_tenant@h/db",
    fleet: "postgres://bms_fleet@h/db",
  });
}

export function assertNamesEveryMissingVariableAtOnce(): void {
  expect(() =>
    resolveDatabaseUrls({ DATABASE_URL_TENANT: "postgres://bms_tenant@h/db" }),
  ).toThrow("DATABASE_URL_AUTH, DATABASE_URL_FLEET");
}

export function assertRefusesToFallBackToDatabaseUrl(): void {
  expect(() =>
    resolveDatabaseUrls({ DATABASE_URL: "postgres://bms_app@h/db" }),
  ).toThrow("DATABASE_URL_AUTH, DATABASE_URL_TENANT, DATABASE_URL_FLEET");
}
