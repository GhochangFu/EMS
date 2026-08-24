import { describe, it } from "vitest";

import {
  assertNamesEveryMissingVariableAtOnce,
  assertRefusesToFallBackToDatabaseUrl,
  assertReturnsAllThreeWhenAllThreeAreSet,
} from "./database-urls.spec";

describe("F4.16 — three-way DATABASE_URL split", () => {
  it("returns all three when all three are set", () => {
    assertReturnsAllThreeWhenAllThreeAreSet();
  });

  it("names every missing variable at once", () => {
    assertNamesEveryMissingVariableAtOnce();
  });

  it("refuses to fall back to DATABASE_URL, which is the owner", () => {
    assertRefusesToFallBackToDatabaseUrl();
  });
});
