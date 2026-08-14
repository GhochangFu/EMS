import { z } from "zod";
import type { TelemetryReading } from "@bms/shared";

/**
 * Validation for the `bms_telemetry` NOTIFY payload (`F4.36`).
 *
 * **Why this exists, and why it is not merely defence in depth.** Before it,
 * `parseNotification` checked that `readings` was an array and then cast the
 * contents to `TelemetryReading[]` unchecked. `NOTIFY` requires no table
 * privilege, so any role that can connect to the database can publish to the
 * channel — the trust boundary is database credentials, not the MQTT edge, and
 * the ingest normaliser is only *one* possible writer.
 *
 * Three consequences were reproduced against the running stack on 2026-08-14 by
 * publishing one malformed payload:
 *
 * 1. **Alarm evaluation stopped for the whole batch.**
 *    `AlarmThresholdService.evaluateReadings` begins with `collapseLatest`,
 *    which iterates every reading and dereferences `r.assetId`. A single `null`
 *    entry threw `TypeError` *before any rule ran*, and the throw is caught and
 *    logged as a warning — so one bad reading silently suppressed alarms for
 *    every good reading beside it. That is the failure that makes this a
 *    correctness fix rather than hardening.
 * 2. **Junk reached browsers.** `bms_api_telemetry_readings_broadcast_total`
 *    went 1 → 4 for a payload containing a bare string and a `null`.
 * 3. **A dead asset renders as healthy.** `applyReading` in the web client does
 *    `new Date(r.time).getTime()`, and `deriveStatus` computes
 *    `Date.now() - lastSeenMs > FRESH_MS`. With an unparsable `time` that is
 *    `NaN > 25000` → `false` → *not stale* → status `running`. A garbage
 *    timestamp makes an offline asset look fine, which is the wrong direction
 *    for a monitoring product.
 *
 * **Invalid readings are dropped; the rest of the batch is delivered.** The row
 * left this open ("drop the batch, or drop the bad readings"). Consequence 1
 * settles it: dropping whole batches would let one malformed reading blind the
 * alarm path for everything published alongside it, which is precisely the
 * failure being fixed. Drops are counted (`onDropped`) rather than swallowed.
 */

/**
 * One reading, matching `TelemetryReading` exactly.
 *
 * Unknown keys are **stripped** rather than rejected — `z.object` strips by
 * default and that is wanted here: a producer that adds a field should not have
 * its readings dropped, and nothing outside these five fields should reach a
 * browser.
 */
export const telemetryReadingSchema = z.object({
  /**
   * Must parse as a date. `z.string().datetime()` is deliberately not used: it
   * demands RFC 3339 and would reject formats `new Date()` accepts, dropping
   * readings the UI would have rendered correctly. The property that matters is
   * exactly the one the client relies on — that `new Date(time)` is not
   * `Invalid Date`.
   */
  time: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "must be a parsable timestamp",
    }),
  assetId: z.string().min(1),
  pointKey: z.string().min(1),
  /**
   * `.finite()` rejects `NaN` and `±Infinity`. `NaN` is a legal
   * `double precision` value in Postgres and the column has no CHECK constraint
   * (`F4.32`), so it can reach this channel from a direct writer. It survives
   * `JSON.stringify` as `null`, which this then rejects as a non-number.
   */
  value: z.number().finite(),
  /**
   * Tolerant on input, exact on output. The declared type is `string | null`,
   * but a producer omitting the key entirely should not lose the reading — an
   * absent `unit` is normalised to `null` rather than dropped.
   */
  unit: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
});

export type ReadingParseResult = {
  readonly readings: TelemetryReading[];
  readonly dropped: number;
  /**
   * Distinct field paths that failed, e.g. `["time", "value"]`.
   *
   * **Paths only, never values** (§9.6). A rejected payload is attacker- or
   * bug-controlled data of unknown provenance; echoing it into the log would
   * turn a validation failure into a log-injection and secret-spill surface.
   * The field name is what an operator needs to find the producer.
   */
  readonly failedFields: readonly string[];
};

/**
 * Validates a decoded payload's `readings`, keeping the valid ones.
 *
 * Returns `null` when the payload carries no readings array at all — the case
 * the pre-`F4.36` code already handled by returning early.
 */
export function parseReadings(payload: unknown): ReadingParseResult | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const candidate = (payload as { readings?: unknown }).readings;
  if (!Array.isArray(candidate)) {
    return null;
  }

  const readings: TelemetryReading[] = [];
  const failedFields = new Set<string>();
  let dropped = 0;

  for (const entry of candidate) {
    const result = telemetryReadingSchema.safeParse(entry);
    if (result.success) {
      readings.push(result.data);
      continue;
    }
    dropped += 1;
    for (const issue of result.error.issues) {
      // `path` is empty when the entry itself is the wrong type (a bare string,
      // `null`), which is exactly the shape that broke alarm evaluation — so it
      // gets a name rather than an empty string.
      failedFields.add(issue.path.length > 0 ? issue.path.join(".") : "<entry>");
    }
  }

  return { readings, dropped, failedFields: [...failedFields].sort() };
}
