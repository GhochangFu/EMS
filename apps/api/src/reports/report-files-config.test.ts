import { describe, it } from "vitest";

import {
  assertBlankCapDefaultsTo50,
  assertExplicitCapIsHonoured,
  assertHistoryUrlIsTrimmedAndLosesItsTrailingSlash,
  assertHistoryUrlUserinfoIsDropped,
  assertInvalidCapDefaultsWithOneWarnNamingTheVariableNotTheValue,
  assertInvalidEmailMaxBytesDefaultsWithOneWarn,
  assertInvalidRetentionPerScheduleDefaultsWithOneWarn,
  assertNonHttpHistoryUrlDefaultsToNullWithOneWarnNamingTheVariable,
  assertRetentionAtTheFormatCountIsHonouredWithNoWarn,
  assertRetentionBelowTheFormatCountIsClampedToItWithOneWarn,
  assertUnsetCapDefaultsTo50,
  assertUnsetThreeNewFieldsDefaultWithNoWarn,
  assertValidHttpsHistoryUrlIsHonoured,
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

  it("defaults retentionPerSchedule, emailMaxBytes and historyUrl with no warn when unset", () => {
    assertUnsetThreeNewFieldsDefaultWithNoWarn();
  });

  it("defaults retentionPerSchedule with one warn naming REPORT_RETENTION_PER_SCHEDULE for 0", () => {
    assertInvalidRetentionPerScheduleDefaultsWithOneWarn();
  });

  it('clamps REPORT_RETENTION_PER_SCHEDULE="1" to the format count 2 with one warn (step-5 finding)', () => {
    assertRetentionBelowTheFormatCountIsClampedToItWithOneWarn();
  });

  it('honours REPORT_RETENTION_PER_SCHEDULE="2" — at the floor — with no warn', () => {
    assertRetentionAtTheFormatCountIsHonouredWithNoWarn();
  });

  it("defaults emailMaxBytes with one warn naming REPORT_EMAIL_MAX_BYTES for an invalid value", () => {
    assertInvalidEmailMaxBytesDefaultsWithOneWarn();
  });

  it("defaults historyUrl to null with one warn naming REPORT_HISTORY_URL for a non-http(s) URL", () => {
    assertNonHttpHistoryUrlDefaultsToNullWithOneWarnNamingTheVariable();
  });

  it("honours a valid https REPORT_HISTORY_URL", () => {
    assertValidHttpsHistoryUrlIsHonoured();
  });

  it("drops the userinfo from REPORT_HISTORY_URL (step-5 security finding)", () => {
    assertHistoryUrlUserinfoIsDropped();
  });

  it("trims REPORT_HISTORY_URL and removes its trailing slash", () => {
    assertHistoryUrlIsTrimmedAndLosesItsTrailingSlash();
  });
});
