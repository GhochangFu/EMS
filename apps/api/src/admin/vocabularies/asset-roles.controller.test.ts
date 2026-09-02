import { describe, it } from "vitest";

import {
  assertCreateTurnsAZodErrorIntoABadRequest,
  assertListPassesTheActiveFilterThrough,
  assertThePatchParamIsACodeAndNotAUuid,
  assertUpdateRefusesAnUnknownKey,
} from "./asset-roles.controller.spec";

/**
 * `F3.40` — Vitest entry point for the asset role controller. Assertions live
 * in the sibling `.spec` (ADR 0014). No database: the service is a stub, so
 * this runs everywhere the suite runs.
 */
describe("F3.40 — AssetRolesAdminController", () => {
  it("passes the ?active tri-state through, with no filter meaning every row", async () => {
    await assertListPassesTheActiveFilterThrough();
  });

  it("turns a malformed create body into a 400 before the service is called", async () => {
    await assertCreateTurnsAZodErrorIntoABadRequest();
  });

  it("parses the patch param as a code, not as a uuid", async () => {
    await assertThePatchParamIsACodeAndNotAUuid();
  });

  it("refuses an unknown key in the patch body", async () => {
    await assertUpdateRefusesAnUnknownKey();
  });
});
