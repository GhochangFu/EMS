import { describe, it } from "vitest";

import {
  aMalformedBodyIs400BeforeTheDatabase,
  aNonGlobalAdminIs403FirstOnEveryRoute,
  aSeededPairPostIs409BeforeTheDatabase,
  anEmptyPatchIs400BeforeTheDatabase,
  theUpdateAuditCarriesTheOldValues,
} from "./point-key-states.service.gates.spec";

/** `F4.309` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.309 — PointKeyStatesAdminService gates before the database (plan C7)", () => {
  it("answers 403 first to a non-global-admin on every route", () => aNonGlobalAdminIs403FirstOnEveryRoute());
  it("answers 400 to a malformed body", () => aMalformedBodyIs400BeforeTheDatabase());
  it("answers 409 to a POST of a seeded pair", () => aSeededPairPostIs409BeforeTheDatabase());
  it("answers 400 to an empty PATCH", () => anEmptyPatchIs400BeforeTheDatabase());
  it("writes the update audit row with the old and the new values, read in the transaction", () =>
    theUpdateAuditCarriesTheOldValues());
});
