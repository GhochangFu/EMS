/**
 * The DI token for `bms.report_files`'s reader config (ADR 0071 decision 11,
 * R-11). `ReportsModule` provides it from `readReportFilesConfig(process.env)`;
 * `ReportFilesService` injects it to read the on-demand cap. A symbol, like
 * the queue and database tokens, so no string can alias it by accident.
 */
export const REPORT_FILES_CONFIG = Symbol("REPORT_FILES_CONFIG");
