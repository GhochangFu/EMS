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
 *    `AlarmEngineService.evaluateReadings` (named `AlarmThresholdService` at
 *    the time, renamed by F3.6) runs `collapseLatest` before any
 *    rule, and it iterates every reading and dereferences `r.assetId`. A single
 *    `null` entry threw `TypeError`, and the throw is caught and logged as a
 *    warning — so one bad reading silently suppressed alarms for every good
 *    reading beside it. That is the failure that makes this a correctness fix
 *    rather than hardening. The reproduced shape was the narrow one: `{}` does
 *    not throw there, it produces an `undefined:undefined` map key and a
 *    garbage reading that flows *into* rule evaluation. Validation covers that
 *    whole class, not only the shape that crashed.
 * 2. **Junk reached browsers.** `bms_api_telemetry_readings_broadcast_total`
 *    went 1 → 4 for a payload containing a bare string and a `null`.
 * 3. **A dead asset renders as healthy — and this schema only closes half of
 *    it.** `applyReading` in the web client does `new Date(r.time).getTime()`,
 *    and `deriveStatus` computes `Date.now() - lastSeenMs > FRESH_MS`. With an
 *    unparsable `time` that is `NaN > 25000` → `false` → *not stale* → status
 *    `running`. The `Date.parse` rule below removes the `NaN` route. It does
 *    **not** remove the arithmetic: a *future* `time` makes the difference
 *    negative, which is also not `> FRESH_MS`, so the same asset renders
 *    `running` by a different input — and it stays that way until a genuine
 *    reading arrives, which for a dead asset is never. Raised by the `F4.36`
 *    security review and left open deliberately as **`F4.37`**, because the
 *    honest fix is to clamp at the sink (`Math.min(t, Date.now())` in the web
 *    client) rather than reject here: `resolveSamples` trusts `sample.at` from
 *    the adapter, so an RTU with a skewed clock emits future timestamps
 *    legitimately — the unclamped `sample.at` already deferred to `F1.7`. A
 *    server-side reject would delete real telemetry to fix a client-side
 *    arithmetic bug.
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
    })
    .describe("Must be a timestamp `Date.parse` accepts; ISO 8601 is the expected form."),
  assetId: z.string().min(1),
  pointKey: z.string().min(1),
  /**
   * `z.number()` already rejects `NaN`; **`.finite()` is here for `±Infinity`**,
   * which it alone rejects. Both are reachable and by different routes, which is
   * why the attribution matters:
   *
   * - `NaN` is a legal `double precision` value in Postgres and the column has
   *   no CHECK constraint (`F4.32`), so a direct writer can store one. It
   *   survives `JSON.stringify` as `null` and is rejected here as a non-number.
   * - `±Infinity` cannot come from `JSON.stringify` — that also emits `null` —
   *   but it *can* come from raw payload text: `JSON.parse('{"value":1e999}')`
   *   yields `Infinity`. `NOTIFY` payloads are text, so this is a real input,
   *   and the spec drives that case from a raw string rather than a serialised
   *   object. The first version of the test used `JSON.stringify` and so proved
   *   nothing about `.finite()` at all — the compliance review caught it.
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

/**
 * Most readings examined in one payload.
 *
 * **This bound is a denial-of-service control, not tidiness.** Validating per
 * entry costs far more than the unchecked cast it replaced — the `F4.36`
 * security review measured ~21–28 ms of event-loop block for an 8 KB payload of
 * `{}` entries against ~1 ms for the widest legitimate chunk, reproduced here
 * at **22.18 ms, falling to 3.08 ms with this cap**. Node is
 * single-threaded, so that is an API-wide stall: REST, WebSocket and `/health`
 * all wait. `NOTIFY` requires **no table privilege at all**, so a role with bare
 * `CONNECT` and no read access could hold the API down at roughly 40
 * notifications a second. Postgres caps a payload at 8000 bytes, but that
 * bounds *bytes*, not *entries*, and `{}` is two of them.
 *
 * 500 is ~8× headroom over anything real: `MAX_NOTIFY_UTF8_BYTES` in
 * `apps/ingest/src/host/chunk.ts` is 7000, and the widest legitimate chunk that
 * fits is **63** readings. The overflow is counted through `dropped` rather
 * than ignored, so truncation is visible on the metric instead of silent.
 */
export const MAX_READINGS_PER_PAYLOAD = 500;

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
  let examined = 0;

  for (const entry of candidate) {
    if (examined >= MAX_READINGS_PER_PAYLOAD) {
      // Count the remainder rather than silently ignoring it, so the metric
      // still reflects everything refused.
      dropped += candidate.length - examined;
      failedFields.add("<overflow>");
      break;
    }
    examined += 1;

    // Cheap type guard before `safeParse`. A `ZodError` extends `Error` and
    // captures a stack, so constructing one per junk entry is what makes a
    // flood expensive; `{}` alone yields four issues. Measured here on an
    // 8 KB payload of bare `0` entries: **5.21 ms → 0.02 ms**.
    //
    // This has **no behavioural signature** — `safeParse` refuses the same
    // entries with the same `<entry>` label — so no test can detect its
    // removal, and the mutation proving that was run rather than assumed. The
    // cap below is the load-bearing control; this is an optimisation.
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      dropped += 1;
      failedFields.add("<entry>");
      continue;
    }

    const result = telemetryReadingSchema.safeParse(entry);
    if (result.success) {
      readings.push(result.data);
      continue;
    }
    dropped += 1;
    for (const issue of result.error.issues) {
      // `path` is empty when the entry is an object that fails as a whole; the
      // non-object case is named `<entry>` by the guard above.
      failedFields.add(issue.path.length > 0 ? issue.path.join(".") : "<entry>");
    }
  }

  return { readings, dropped, failedFields: [...failedFields].sort() };
}
