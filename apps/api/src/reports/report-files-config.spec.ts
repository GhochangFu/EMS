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

export function assertValidHttpsHistoryUrlIsHonoured(): void {
  const { warns, logger } = fakeLogger();
  const config = readReportFilesConfig({ REPORT_HISTORY_URL: "https://bms.example" }, logger);
  assert(
    config.historyUrl === "https://bms.example",
    `expected "https://bms.example", got ${JSON.stringify(config.historyUrl)}`,
  );
  assert(warns.length === 0, `a valid REPORT_HISTORY_URL must not warn, got ${JSON.stringify(warns)}`);
}
