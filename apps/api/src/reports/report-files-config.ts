import { Logger } from "@nestjs/common";

import { REPORT_ONDEMAND_CAP_DEFAULT } from "@bms/shared";

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
 */
export type ReportFilesConfig = {
  readonly onDemandCap: number;
};

const REPORT_ONDEMAND_CAP_FLOOR = 1;

export function readReportFilesConfig(
  env: Record<string, string | undefined>,
  logger: Pick<Logger, "warn"> = new Logger("ReportFilesConfig"),
): ReportFilesConfig {
  const raw = env.REPORT_ONDEMAND_CAP?.trim();
  if (raw === undefined || raw === "") {
    return { onDemandCap: REPORT_ONDEMAND_CAP_DEFAULT };
  }

  const isInteger = /^-?\d+$/.test(raw);
  const value = Number(raw);

  if (!isInteger || !Number.isInteger(value) || value < REPORT_ONDEMAND_CAP_FLOOR) {
    logger.warn(
      `REPORT_ONDEMAND_CAP is not a valid integer >= ${REPORT_ONDEMAND_CAP_FLOOR}; using the default`,
    );
    return { onDemandCap: REPORT_ONDEMAND_CAP_DEFAULT };
  }

  return { onDemandCap: value };
}
