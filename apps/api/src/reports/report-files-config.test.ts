import { describe, it } from "vitest";

import {
  assertBlankCapDefaultsTo50,
  assertExplicitCapIsHonoured,
  assertInvalidCapDefaultsWithOneWarnNamingTheVariableNotTheValue,
  assertUnsetCapDefaultsTo50,
  INVALID_ONDEMAND_CAPS,
} from "./report-files-config.spec";

/**
 * ADR 0071 decision 11 (R-11) — Vitest entry point for
 * `readReportFilesConfig`. Assertions live in the sibling `.spec`
 * (§4.6/ADR 0014); this file only runs them.
 */
describe("ADR 0071 decision 11 — readReportFilesConfig", () => {
  it("defaults to 50 when REPORT_ONDEMAND_CAP is unset", () => {
    assertUnsetCapDefaultsTo50();
  });

  it("defaults to 50 when REPORT_ONDEMAND_CAP is blank", () => {
    assertBlankCapDefaultsTo50();
  });

  it("honours an explicit REPORT_ONDEMAND_CAP=25", () => {
    assertExplicitCapIsHonoured();
  });

  it.each(INVALID_ONDEMAND_CAPS)(
    "defaults to 50 with one warn naming REPORT_ONDEMAND_CAP, not the value, for %s",
    (raw) => {
      assertInvalidCapDefaultsWithOneWarnNamingTheVariableNotTheValue(raw);
    },
  );
});
