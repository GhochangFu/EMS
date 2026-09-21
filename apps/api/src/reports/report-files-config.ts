import { Logger } from "@nestjs/common";

import {
  REPORT_EMAIL_MAX_BYTES_DEFAULT,
  REPORT_FILE_FORMATS,
  REPORT_ONDEMAND_CAP_DEFAULT,
  REPORT_RETENTION_PER_SCHEDULE_DEFAULT,
} from "@bms/shared";

/**
 * The `REPORT_ONDEMAND_CAP` reader (ADR 0071 decision 11, R-11) — the
 * `queue-config.ts` reader shape, adapted: a bad value never refuses the
 * boot (there is no worker-style "nothing else to do" here), it falls back
 * to `REPORT_ONDEMAND_CAP_DEFAULT` with exactly one `warn` naming the
 * variable. **The value itself is never in the warn** — not because it is a
 * secret, but because a guard that fails closed must not restate the bad
 * input as if it were meaningful; the operator reads it from their own env.
 *
 * The cap is read once, at module-provider time, and handed through the
 * `REPORT_FILES_CONFIG` token — the same "read once, provide through the
 * graph" shape `WORKER_CONFIG` uses.
 *
 * F3.5b (R-14) adds three fields on the same reader rule:
 * `retentionPerSchedule` (`REPORT_RETENTION_PER_SCHEDULE`, default
 * `REPORT_RETENTION_PER_SCHEDULE_DEFAULT`) and `emailMaxBytes`
 * (`REPORT_EMAIL_MAX_BYTES`, floor 1, default `REPORT_EMAIL_MAX_BYTES_DEFAULT`)
 * — each a bad-value-warns-and-defaults integer read; and `historyUrl`
 * (`REPORT_HISTORY_URL`, optional) — a bad or non-`http(s)` value warns
 * naming the variable and falls back to `null`, an unset value falls back to
 * `null` with **no** warn (there is nothing wrong to report).
 *
 * **`retentionPerSchedule`'s effective floor is `REPORT_FILE_FORMATS.length`
 * (step-5 finding; plan R-14 said floor 1).** The render job's prune keeps
 * the newest `n` rows of a schedule by `created_at DESC, id DESC`; one run
 * inserts up to one row per format in the same transaction, so they share
 * `now()` and tie on a random uuid. With `n` below the format count the
 * prune would delete one of the run's own rows. A value that passes the
 * integer read but is below the format count is clamped up to it with one
 * warn naming the variable; a value below 1 still defaults with the
 * reader's own warn.
 *
 * **`historyUrl` is normalised, never the raw string** (step-5 security
 * finding): the value is interpolated into every report mail body, so the
 * userinfo (`u:p@`) is cleared, the string trimmed and a trailing `/`
 * removed — the body appends `/reports`.
 */
export type ReportFilesConfig = {
  readonly onDemandCap: number;
  readonly retentionPerSchedule: number;
  readonly emailMaxBytes: number;
  readonly historyUrl: string | null;
};

const REPORT_ONDEMAND_CAP_FLOOR = 1;
const REPORT_RETENTION_PER_SCHEDULE_FLOOR = 1;
const REPORT_EMAIL_MAX_BYTES_FLOOR = 1;

/**
 * The retention a run needs so the prune never reaches its own rows: one
 * row per format. Applied after the integer read (a value below 1 is the
 * reader's warn-and-default; a value in `[1, formats)` is this clamp).
 */
function clampRetentionToTheFormatCount(value: number, logger: Pick<Logger, "warn">): number {
  const floor = REPORT_FILE_FORMATS.length;
  if (value >= floor) {
    return value;
  }
  logger.warn(
    `REPORT_RETENTION_PER_SCHEDULE is below the number of report formats one run writes; using ${floor} so the prune never deletes a run's own rows`,
  );
  return floor;
}

function readPositiveInteger(
  raw: string | undefined,
  variableName: string,
  floor: number,
  fallback: number,
  logger: Pick<Logger, "warn">,
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const isInteger = /^-?\d+$/.test(raw);
  const value = Number(raw);

  if (!isInteger || !Number.isInteger(value) || value < floor) {
    logger.warn(`${variableName} is not a valid integer >= ${floor}; using the default`);
    return fallback;
  }

  return value;
}

/**
 * `REPORT_HISTORY_URL` — optional. Unset reads as `null` with no warn; a set
 * value must parse with `new URL()` and carry the `http:` or `https:`
 * protocol, else it falls back to `null` with one warn naming the variable
 * (never the value, the same rule as the integer readers). What is
 * returned is the parsed URL's `href` with the userinfo cleared, whitespace
 * trimmed and a trailing `/` removed — never `raw` (step-5 security
 * finding: the value is written into every report mail body).
 */
function readHistoryUrl(
  raw: string | undefined,
  logger: Pick<Logger, "warn">,
): string | null {
  if (raw === undefined || raw.trim() === "") {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    logger.warn("REPORT_HISTORY_URL is not a valid URL; using no history link");
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    logger.warn("REPORT_HISTORY_URL must use the http or https scheme; using no history link");
    return null;
  }

  parsed.username = "";
  parsed.password = "";
  return parsed.href.replace(/\/$/, "");
}

export function readReportFilesConfig(
  env: Record<string, string | undefined>,
  logger: Pick<Logger, "warn"> = new Logger("ReportFilesConfig"),
): ReportFilesConfig {
  return {
    onDemandCap: readPositiveInteger(
      env.REPORT_ONDEMAND_CAP,
      "REPORT_ONDEMAND_CAP",
      REPORT_ONDEMAND_CAP_FLOOR,
      REPORT_ONDEMAND_CAP_DEFAULT,
      logger,
    ),
    retentionPerSchedule: clampRetentionToTheFormatCount(
      readPositiveInteger(
        env.REPORT_RETENTION_PER_SCHEDULE,
        "REPORT_RETENTION_PER_SCHEDULE",
        REPORT_RETENTION_PER_SCHEDULE_FLOOR,
        REPORT_RETENTION_PER_SCHEDULE_DEFAULT,
        logger,
      ),
      logger,
    ),
    emailMaxBytes: readPositiveInteger(
      env.REPORT_EMAIL_MAX_BYTES,
      "REPORT_EMAIL_MAX_BYTES",
      REPORT_EMAIL_MAX_BYTES_FLOOR,
      REPORT_EMAIL_MAX_BYTES_DEFAULT,
      logger,
    ),
    historyUrl: readHistoryUrl(env.REPORT_HISTORY_URL, logger),
  };
}
