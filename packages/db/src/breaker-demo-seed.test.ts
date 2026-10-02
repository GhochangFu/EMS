import { describe, it } from "vitest";

import {
  aRoleStillMccAfterStepOneThrowsNamingIt,
  aRoleStillNullAfterStepOneThrowsNamingIt,
  twelveSetRolesPassStepOne,
} from "./breaker-demo-seed.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.74 D11 — the breaker demo seed's role read-back", () => {
  it("throws naming a breaker whose role is still mcc after the role step", async () => {
    await aRoleStillMccAfterStepOneThrowsNamingIt();
  });
  it("throws naming a breaker whose role is still NULL after the role step", async () => {
    await aRoleStillNullAfterStepOneThrowsNamingIt();
  });
  it("passes twelve set roles, an administrator's among them", async () => {
    await twelveSetRolesPassStepOne();
  });
});
