import { describe, it } from "vitest";

import {
  assertNamesEveryMissingVariableAtOnce,
  assertOneEntryPerRoleWhenAllThreeAreSet,
  assertRefusesAnEmptyPassword,
} from "./roles.spec";

describe("F4.16 — role password wiring", () => {
  it("returns one entry per role when all three are set", () => {
    assertOneEntryPerRoleWhenAllThreeAreSet();
  });

  it("names every missing variable at once rather than failing on the first", () => {
    assertNamesEveryMissingVariableAtOnce();
  });

  it("refuses an empty password rather than setting one", () => {
    assertRefusesAnEmptyPassword();
  });
});
