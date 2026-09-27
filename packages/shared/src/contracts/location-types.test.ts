import { describe, it } from "vitest";

import {
  runAdminLocationTypeDtoRefusesNegativeLocationCountTest,
  runAdminLocationTypeDtoRequiresLocationCountTest,
  runAdminLocationTypesListResponseParsesTest,
  runLocationTypeCodeBoundsTests,
} from "./location-types.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.157 — locationTypeCodeSchema (ADR 0077 D1)", () => {
  it("C1 — accepts a live code, refuses an empty string and a 33-character code", () => {
    runLocationTypeCodeBoundsTests();
  });
});

describe("F4.162 — adminLocationTypeDtoSchema / adminLocationTypesListResponseSchema (ADR 0077 Amendment 1, D3)", () => {
  it("C7 — refuses a row without locationCount", () => {
    runAdminLocationTypeDtoRequiresLocationCountTest();
  });

  it("C8 — refuses locationCount: -1", () => {
    runAdminLocationTypeDtoRefusesNegativeLocationCountTest();
  });

  it("C9 — adminLocationTypesListResponseSchema parses { items: [<full row>] }", () => {
    runAdminLocationTypesListResponseParsesTest();
  });
});
