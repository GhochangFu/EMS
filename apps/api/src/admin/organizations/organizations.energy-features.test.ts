import { describe, it } from "vitest";

import {
  runAnUnknownValueIsRefused,
  runEveryListedValueIsAccepted,
  runTheCreateBodyRefusesBothKeys,
  runTheDtoRequiresBothSettings,
  runTheUpdateBodyStaysStrict,
} from "./organizations.energy-features.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.364 — organization energy settings on the read and write contracts (ADR 0133)", () => {
  it("S1 every listed value is accepted on update", () => {
    runEveryListedValueIsAccepted();
  });

  it("S2 an unknown value is refused", () => {
    runAnUnknownValueIsRefused();
  });

  it("S3 the update body stays strict", () => {
    runTheUpdateBodyStaysStrict();
  });

  it("S4 the create body refuses both keys", () => {
    runTheCreateBodyRefusesBothKeys();
  });

  it("S5 the organization DTO requires both settings", () => {
    runTheDtoRequiresBothSettings();
  });
});
