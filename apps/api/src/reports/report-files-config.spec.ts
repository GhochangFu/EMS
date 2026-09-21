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
