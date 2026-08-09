import { BadRequestException } from "@nestjs/common";

/**
 * Export ceilings for the audit read API (ADR 0021 decision 5).
 *
 * Separate from `audit.schema.ts` because the span is a *query* contract Zod can
 * enforce, while the row cap can only be checked after counting — a different
 * moment, and one that needs its own caller in a test.
 */

/** Longest export window permitted. */
export const MAX_EXPORT_SPAN_DAYS = 366;

/**
 * Row ceiling for a single export.
 *
 * **Measured 2026-08-09**, as ADR 0021 decision 5 requires, against synthetic
 * rows carrying a realistic `payload: body` for an asset create (one of the
 * twelve such call sites):
 * 50,000 rows → 2.47 s, a 42.6 MB workbook, 144 MB heapUsed and 502 MB RSS,
 * against Node's 2,240 MB default heap limit. `docker-compose.yml` sets no
 * memory limit on the `api` service, so the cap is **confirmed rather than
 * lowered**.
 *
 * The residual risk is concurrency, not size: each in-flight export costs
 * roughly half a gigabyte of RSS, so a handful at once is the failure mode
 * rather than one large one. Bounding concurrent exports is follow-up work and
 * belongs with `F4.17` (rate limiting), not here.
 */
export const MAX_EXPORT_ROWS = 50_000;

/**
 * Refuses an export larger than the cap, naming the count so the caller knows
 * how much to narrow by. Deliberately not a truncation: a short file that looks
 * complete is the outcome ADR 0021 rejects.
 */
export function assertWithinExportCap(total: number, cap: number = MAX_EXPORT_ROWS): void {
  if (total > cap) {
    throw new BadRequestException(
      `Export matches ${total} rows, above the ${cap} row limit. ` +
        "Narrow the time window or add a filter.",
    );
  }
}
