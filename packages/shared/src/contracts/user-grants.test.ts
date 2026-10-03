import { describe, it } from "vitest";

import * as spec from "./user-grants.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 — user grants API contracts (ADR 0089 decision 12)", () => {
  it("the add body accepts each of the three kinds", () => {
    spec.assertAddBodyAcceptsEachOfTheThreeKinds();
  });

  it("the add body refuses an unknown kind", () => {
    spec.assertAddBodyRefusesAnUnknownKind();
  });

  it("the add body refuses an extra key", () => {
    spec.assertAddBodyRefusesAnExtraKey();
  });

  it("the add body refuses a target that is not a uuid", () => {
    spec.assertAddBodyRefusesANonUuidTarget();
  });

  it("the response refuses a grant without effective", () => {
    spec.assertResponseRefusesAGrantWithoutEffective();
  });
});
