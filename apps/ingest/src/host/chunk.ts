/**
 * The single `pg_notify` chunker (ADR 0016 §2).
 *
 * There are two byte-identical copies of this function on `main` today —
 * `chunkReadings()` in `apps/ingest/src/index.js` and
 * `chunkReadingsForNotify()` in `apps/sim/src/index.js`, each with its own
 * `MAX_NOTIFY_UTF8_BYTES = 7000`. ADR 0016 §2 makes the host the owner so a
 * third copy per protocol is not the default outcome of the F1.2–F1.6 fan-out.
 *
 * Neither copy is edited here. `index.js` is frozen for the whole strangler
 * window (§6) and `apps/sim` keeps its own write path until `F1.11` decides
 * otherwise (§Consequences, Neutral).
 */

/**
 * Ceiling on one `pg_notify` payload, in UTF-8 bytes.
 *
 * Postgres's own limit is 8000 bytes for the whole notification; 7000 leaves
 * room for the channel name and framing. Carried over from `index.js`
 * unchanged — this is a compatibility constant, not a tuning knob.
 */
export const MAX_NOTIFY_UTF8_BYTES = 7000;

/** One reading as it appears inside the `bms_telemetry` payload. */
export type NotifyReading = {
  /** ISO-8601, because the payload is JSON and a `Date` would not survive it. */
  readonly time: string;
  readonly assetId: string;
  readonly pointKey: string;
  readonly value: number;
  readonly unit: string | null;
};

/**
 * Bytes of `{"readings":[]}` — the envelope every chunk is measured inside.
 *
 * `{` + `"readings"` + `:` + `[` + `]` + `}` = 1 + 10 + 1 + 1 + 1 + 1.
 */
const ENVELOPE_BYTES = 15;

/**
 * Splits readings into payloads that each fit `maxBytes` once wrapped in
 * `{"readings": …}`.
 *
 * **A single reading larger than the cap gets its own oversized chunk rather
 * than being dropped.** That is what `index.js` does, and losing a reading
 * silently is worse than a NOTIFY that Postgres rejects loudly. No reading this
 * repo produces comes close — the widest is a UUID pair plus a float.
 *
 * The legacy implementation re-serialises the entire accumulated array once per
 * reading, which is O(n²) in `JSON.stringify`. Tolerable for a handful of MQTT
 * points; a Modbus adapter reading 500 registers would serialise ~125 000
 * elements to emit one batch. This computes the same boundaries incrementally,
 * exploiting the fact that `JSON.stringify` of an array is the concatenation of
 * its elements' own serialisations joined by single commas:
 *
 *     bytes(chunk) = ENVELOPE_BYTES + Σ bytes(item) + (count − 1)
 *
 * That identity is not taken on trust. `chunk.spec.ts` runs both algorithms
 * over randomised inputs and asserts the chunk boundaries agree exactly — the
 * rewrite has to earn its place in front of the live pilot.
 */
export function chunkReadings(
  readings: readonly NotifyReading[],
  maxBytes: number = MAX_NOTIFY_UTF8_BYTES,
): NotifyReading[][] {
  const chunks: NotifyReading[][] = [];
  let current: NotifyReading[] = [];
  let currentBytes = 0;

  for (const reading of readings) {
    const itemBytes = Buffer.byteLength(JSON.stringify(reading), "utf8");
    // One separating comma per already-present element.
    const trialBytes = ENVELOPE_BYTES + currentBytes + itemBytes + current.length;

    if (trialBytes <= maxBytes) {
      current.push(reading);
      currentBytes += itemBytes;
      continue;
    }

    if (current.length > 0) {
      // Close the chunk and start a new one holding this reading.
      chunks.push(current);
      current = [reading];
      currentBytes = itemBytes;
      continue;
    }

    // Nothing accumulated and it still does not fit: emit it alone, oversized.
    chunks.push([reading]);
    current = [];
    currentBytes = 0;
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
