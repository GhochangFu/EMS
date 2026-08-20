/**
 * Chunks readings for one `pg_notify('bms_telemetry', ...)` payload.
 *
 * A third independent copy of the shape `apps/ingest/src/host/chunk.ts` and
 * `apps/sim/src/index.js` each already carry. ADR 0016's own "Neutral"
 * consequence already accepted a per-app copy of this concern rather than
 * forcing every writer through one shared module — `apps/api` is another
 * independent deployable in exactly that category, not a second copy inside
 * the same one. The simple re-stringify-per-item approach is used rather than
 * `chunk.ts`'s incremental one: ADR 0016 calls that fine "for a handful of
 * MQTT points," and the only readings this ever chunks are the *live* subset
 * of one write batch (`NOTIFY_LIVE_WINDOW_MS` in `telemetry-write.service.ts`)
 * — a handful, not a device stream.
 */

/** Postgres's own NOTIFY payload limit is 8000 bytes; this leaves framing room. */
export const MAX_NOTIFY_UTF8_BYTES = 7000;

/** One reading as it appears inside the `bms_telemetry` payload. */
export type NotifyReading = {
  readonly time: string;
  readonly assetId: string;
  readonly pointKey: string;
  readonly value: number;
  readonly unit: string | null;
};

/**
 * Splits readings into payloads that each fit `maxBytes` once wrapped in
 * `{"readings": …}`. A reading that does not fit even alone gets its own
 * oversized chunk rather than being silently dropped.
 *
 * Under `telemetryEntryRowSchema`'s own field caps (`pointKey` ≤ 128,
 * `unit` ≤ 32) one serialised reading tops out well under 300 bytes — far
 * under {@link MAX_NOTIFY_UTF8_BYTES} — so that oversized-single-reading
 * branch should be unreachable at the real call site. It stays here so the
 * function is correct for any `maxBytes` a test supplies, not just the
 * default. `TelemetryWriteService` does not rely on it staying unreachable:
 * its `pg_notify` call is wrapped in a try/catch that logs rather than
 * throws, so even a payload this function could not shrink further would
 * not roll back an otherwise-valid, already-committed write.
 */
export function chunkForNotify(
  readings: readonly NotifyReading[],
  maxBytes: number = MAX_NOTIFY_UTF8_BYTES,
): NotifyReading[][] {
  const chunks: NotifyReading[][] = [];
  let current: NotifyReading[] = [];

  for (const reading of readings) {
    const candidate = [...current, reading];
    const bytes = Buffer.byteLength(JSON.stringify({ readings: candidate }), "utf8");

    if (bytes <= maxBytes) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      chunks.push(current);
      current = [reading];
      continue;
    }
    chunks.push([reading]);
    current = [];
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
