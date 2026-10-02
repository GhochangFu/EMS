import { describe, it } from "vitest";

import {
  assertAHashedRowReachesBcrypt,
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
