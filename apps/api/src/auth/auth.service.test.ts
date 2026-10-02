import { describe, it } from "vitest";

import {
  assertADisabledRowIsTheGeneric401BeforeBcrypt,
  assertAHashedRowReachesBcrypt,
  assertAnEnabledRowWithTheRightPasswordSignsIn,
  assertANullHashIsTheGeneric401,
  assertANullHashNeverReachesBcrypt,
} from "./auth.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("AuthService.login — a row with no local password (F3.78, migration 0098)", () => {
  it("refuses a NULL password_hash with the generic 401", async () => {
    await assertANullHashIsTheGeneric401();
  });

  it("never hands a NULL password_hash to bcrypt.compare", async () => {
    await assertANullHashNeverReachesBcrypt();
  });

  it("does call bcrypt.compare for a row with a hash (the spy's positive control)", async () => {
    await assertAHashedRowReachesBcrypt();
  });
});

describe("AuthService.login — a deactivated row (F3.78, ADR 0089 decision 8)", () => {
  it("refuses a disabled row with the generic 401 and never calls bcrypt.compare", async () => {
    await assertADisabledRowIsTheGeneric401BeforeBcrypt();
  });

  it("signs in the same row when it is not disabled (positive control)", async () => {
    await assertAnEnabledRowWithTheRightPasswordSignsIn();
  });
});
