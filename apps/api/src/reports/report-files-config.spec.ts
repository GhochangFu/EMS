import { readReportFilesConfig } from "./report-files-config";

/**
 * ADR 0071 decision 11 (R-11) — `readReportFilesConfig`.
 *
 * Assertions live here; `report-files-config.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). Each bad-value row proves the *reader* is what keeps the
 * cap a number — a guard must fail closed, not just be correct: `Number(raw)
 * || 50` would let `"1.5"` through as `1.5`, since `1.5` is truthy.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function fakeLogger(): { warns: string[]; logger: { warn: (message: string) => void } } {
  const warns: string[] = [];
  return { warns, logger: { warn: (message: string) => warns.push(String(message)) } };
}

export function assertUnsetCapDefaultsTo50(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({}, logger);
  assert(config.onDemandCap === 50, `expected default 50, got ${config.onDemandCap}`);
  assert(warns.length === 0, `unset REPORT_ONDEMAND_CAP must not warn, got ${JSON.stringify(warns)}`);
}

export function assertBlankCapDefaultsTo50(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_ONDEMAND_CAP: "  " }, logger);
  assert(config.onDemandCap === 50, `expected default 50, got ${config.onDemandCap}`);
  assert(warns.length === 0, `a whitespace-only REPORT_ONDEMAND_CAP must not warn, got ${JSON.stringify(warns)}`);
}

export function assertExplicitCapIsHonoured(): void {
  const { logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_ONDEMAND_CAP: "25" }, logger);
  assert(config.onDemandCap === 25, `expected 25, got ${config.onDemandCap}`);
}

export const INVALID_ONDEMAND_CAPS = ["0", "-1", "abc", "1.5"] as const;

export function assertInvalidCapDefaultsWithOneWarnNamingTheVariableNotTheValue(raw: string): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_ONDEMAND_CAP: raw }, logger);
  assert(config.onDemandCap === 50, `expected the default 50 for ${JSON.stringify(raw)}, got ${config.onDemandCap}`);
  assert(warns.length === 1, `expected exactly one warn for ${JSON.stringify(raw)}, got ${warns.length}`);
  assert(
    warns[0]?.includes("REPORT_ONDEMAND_CAP") ?? false,
    `expected the warn to name REPORT_ONDEMAND_CAP for ${JSON.stringify(raw)}, got ${JSON.stringify(warns[0])}`,
  );
  assert(
    !(warns[0]?.includes(raw) ?? false),
    `the warn must not contain the raw value ${JSON.stringify(raw)} — got ${JSON.stringify(warns[0])}`,
  );
}

/**
 * R-14 (F3.5b, plan Unit 4) — `retentionPerSchedule`, `emailMaxBytes`,
 * `historyUrl`. The three new fields, each on the reader's existing
 * bad-value-warns-and-defaults rule.
 */
export function assertUnsetThreeNewFieldsDefaultWithNoWarn(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({}, logger);
  assert(
    config.retentionPerSchedule === 24,
    `expected default retentionPerSchedule 24, got ${config.retentionPerSchedule}`,
  );
  assert(
    config.emailMaxBytes === 10_485_760,
    `expected default emailMaxBytes 10485760, got ${config.emailMaxBytes}`,
  );
  assert(config.historyUrl === null, `expected historyUrl null when unset, got ${JSON.stringify(config.historyUrl)}`);
  assert(warns.length === 0, `unset fields must not warn, got ${JSON.stringify(warns)}`);
}

export function assertInvalidRetentionPerScheduleDefaultsWithOneWarn(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_RETENTION_PER_SCHEDULE: "0" }, logger);
  assert(
    config.retentionPerSchedule === 24,
    `expected the default 24, got ${config.retentionPerSchedule}`,
  );
  assert(warns.length === 1, `expected exactly one warn, got ${warns.length}`);
  assert(
    warns[0]?.includes("REPORT_RETENTION_PER_SCHEDULE") ?? false,
    `expected the warn to name REPORT_RETENTION_PER_SCHEDULE, got ${JSON.stringify(warns[0])}`,
  );
}

/**
 * Step-5 finding: the effective floor is `REPORT_FILE_FORMATS.length` (2),
 * not 1. A retention below the number of formats one run writes would let
 * the prune (`created_at DESC, id DESC OFFSET n`) delete one of the run's
 * own rows — same `now()`, a random uuid tie. `"1"` is a valid integer, so
 * it passes the reader and is clamped to 2 with one warn naming the
 * variable.
 */
export function assertRetentionBelowTheFormatCountIsClampedToItWithOneWarn(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_RETENTION_PER_SCHEDULE: "1" }, logger);
  assert(config.retentionPerSchedule === 2, `expected "1" clamped to the format count 2, got ${config.retentionPerSchedule}`);
  assert(warns.length === 1, `expected exactly one warn for the clamp, got ${JSON.stringify(warns)}`);
  assert(
    warns[0]?.includes("REPORT_RETENTION_PER_SCHEDULE") ?? false,
    `expected the clamp warn to name REPORT_RETENTION_PER_SCHEDULE, got ${JSON.stringify(warns[0])}`,
  );
}

/** Positive control for the clamp: a value at the floor is honoured without a warn. */
export function assertRetentionAtTheFormatCountIsHonouredWithNoWarn(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_RETENTION_PER_SCHEDULE: "2" }, logger);
  assert(config.retentionPerSchedule === 2, `expected 2, got ${config.retentionPerSchedule}`);
  assert(warns.length === 0, `a value at the floor must not warn, got ${JSON.stringify(warns)}`);
}

export function assertInvalidEmailMaxBytesDefaultsWithOneWarn(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_EMAIL_MAX_BYTES: "abc" }, logger);
  assert(
    config.emailMaxBytes === 10_485_760,
    `expected the default 10485760, got ${config.emailMaxBytes}`,
  );
  assert(warns.length === 1, `expected exactly one warn, got ${warns.length}`);
  assert(
    warns[0]?.includes("REPORT_EMAIL_MAX_BYTES") ?? false,
    `expected the warn to name REPORT_EMAIL_MAX_BYTES, got ${JSON.stringify(warns[0])}`,
  );
}

export function assertNonHttpHistoryUrlDefaultsToNullWithOneWarnNamingTheVariable(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_HISTORY_URL: "ftp://x" }, logger);
  assert(config.historyUrl === null, `expected null for ftp://x, got ${JSON.stringify(config.historyUrl)}`);
  assert(warns.length === 1, `expected exactly one warn, got ${warns.length}`);
  assert(
    warns[0]?.includes("REPORT_HISTORY_URL") ?? false,
    `expected the warn to name REPORT_HISTORY_URL, got ${JSON.stringify(warns[0])}`,
  );
}

/**
 * Step-5 security finding: the reader returns a normalised URL, never the
 * raw string. Userinfo is dropped (the value lands in every report mail
 * body — a `u:p@` there is a credential leak), whitespace is trimmed and
 * the trailing `/` removed (the body appends `/reports`).
 */
export function assertHistoryUrlUserinfoIsDropped(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_HISTORY_URL: "https://u:p@host" }, logger);
  assert(config.historyUrl === "https://host", `expected "https://host" with the userinfo dropped, got ${JSON.stringify(config.historyUrl)}`);
  assert(warns.length === 0, `a normalisable URL must not warn, got ${JSON.stringify(warns)}`);
}

export function assertHistoryUrlIsTrimmedAndLosesItsTrailingSlash(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_HISTORY_URL: " https://host/app/ " }, logger);
  assert(config.historyUrl === "https://host/app", `expected "https://host/app", got ${JSON.stringify(config.historyUrl)}`);
  assert(warns.length === 0, `a normalisable URL must not warn, got ${JSON.stringify(warns)}`);
}

export function assertValidHttpsHistoryUrlIsHonoured(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_HISTORY_URL: "https://bms.example" }, logger);
  assert(
    config.historyUrl === "https://bms.example",
    `expected "https://bms.example", got ${JSON.stringify(config.historyUrl)}`,
  );
  assert(warns.length === 0, `a valid REPORT_HISTORY_URL must not warn, got ${JSON.stringify(warns)}`);
}
