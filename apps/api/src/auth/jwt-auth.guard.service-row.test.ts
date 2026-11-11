import { describe, it } from "vitest";

import {
  assertAJwtNamingAServiceRowIsRefused,
  assertTheSameJwtNamingAHumanRowIsAccepted,
} from "./jwt-auth.guard.service-row.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("JwtAuthGuard — a JWT never reaches a service account (F4.17, ADR 0125 decision 10)", () => {
  it("refuses a JWT whose row is kind = service", async () => {
    await assertAJwtNamingAServiceRowIsRefused();
  });

  it("accepts the same JWT when the row is kind = human (positive control)", async () => {
    await assertTheSameJwtNamingAHumanRowIsAccepted();
  });
});
