import { describe, it } from "vitest";

import {
  testDefaultsOffInProduction,
  testDefaultsOnOutsideProduction,
  testExplicitFalseWinsEverywhere,
  testExplicitTrueWinsEverywhere,
  testUnrecognisedValuesFallThroughToTheDefault,
} from "./api-docs-enabled.spec";

/** `F4.20` / ADR 0029 Amendment 2 — Vitest entry point (§4.6). */
describe("ADR 0029 Amendment 2 — when the API docs exist", () => {
  it("is on wherever API_DOCS_ENABLED is explicitly true", () => {
    testExplicitTrueWinsEverywhere();
  });

  it("is off wherever API_DOCS_ENABLED is explicitly false", () => {
    testExplicitFalseWinsEverywhere();
  });

  it("defaults on outside production", () => {
    testDefaultsOnOutsideProduction();
  });

  it("defaults OFF in production", () => {
    testDefaultsOffInProduction();
  });

  it("does not read 1/yes/on as true", () => {
    testUnrecognisedValuesFallThroughToTheDefault();
  });
});
