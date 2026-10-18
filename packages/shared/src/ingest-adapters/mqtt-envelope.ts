/**
 * The ThinkIoT MQTT envelope parse (ADR 0016 §6, `F3.24b`).
 *
 * Moved **verbatim** from `apps/ingest/src/adapters/mqtt.ts` so the ingest
 * adapter and the onboarding discovery collector (ADR 0103) read one parse.
 * It takes a string: this package has no `@types/node`, so the `Buffer`
 * length check stays in ingest. Only the name changed (`parsePayload`).
 */

/**
 * The ThinkIoT envelope: routing and timing, not readings.
 *
 * `dev_id` selects the device and `ts` becomes the sample time, so neither is
 * telemetry. Excluding `ts` is what keeps `device_timestamp` from becoming a
 * point whose value is, by construction, its own row's `time` expressed as
 * epoch milliseconds; `packages/db/src/phe-pilot-seed.ts` stopped cataloguing
 * that point in the same change. `values` is the container.
 *
 * **These three names are ThinkIoT's envelope, not MQTT's.** MQTT has no
 * payload schema, so a different vendor may publish a genuine reading called
 * `ts`. `F1.7` points this adapter at non-PHE devices and is where this needs
 * to become per-connection configuration rather than a module constant —
 * otherwise it is this same bug, forward-dated.
 */
const ENVELOPE_KEYS: ReadonlySet<string> = new Set(["dev_id", "ts", "values"]);

/** Every field of the envelope that could be a reading. */
function readingFields(body: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!ENVELOPE_KEYS.has(key)) {
      fields[key] = value;
    }
  }
  return fields;
}

/**
 * `parsePayload()` from `index.js:111-119`, with two deliberate changes.
 *
 * **1. Top-level readings are reachable.** Legacy takes `body.values` *instead
 * of* the body whenever it is an object, so any reading published beside the
 * `values` block rather than inside it is unreachable — no error, no counter,
 * the mapped point simply never arrives. `rssi` is exactly that: the PHE seed
 * maps it to `network_strength`, `exports/PHE-MQTT-REFERENCE.md` documents the
 * mapping, and it is published at the top level. Verified against the live
 * Bhutnirghat I feed on 2026-08-06, where 20 of the RTU's 22 mapped points
 * landed and this was one of the two that did not.
 *
 * So the two layers are merged rather than chosen between, with the nested
 * block winning on collision — it is the more specific source, and a device
 * that publishes a key in both places means the inner one.
 *
 * This is a **deliberate divergence from `index.js`**, which stays frozen under
 * ADR 0016 §6 while it runs the pilot, and is recorded in
 * `docs/ingest-host.md`. It is not a regression of the §6 commit 3 comparison:
 * that ran on 2026-08-06 against this feed and recorded an identical point set,
 * and where a `values` block is present — as it always is on this feed — this
 * changes the host only for keys the legacy path could never have read.
 * Re-running the comparison after this lands should show exactly one
 * difference, `network_strength`.
 *
 * On a **flat** payload the divergence is the other way: legacy fell back to
 * the whole body, so `dev_id` and `ts` were mappable keys there and are no
 * longer. That is the correction, not a casualty of it.
 *
 * **2. `at` is not fabricated.** Legacy defaults a missing `ts` to
 * `Date.now()`. Under the new contract `at` is set **only** where the protocol
 * genuinely carries a device timestamp, and it is left absent otherwise
 * (`SourceSample.at`) — an honest absence rather than a clock the device never
 * reported.
 *
 * Since **ADR 0061** the host no longer *substitutes* anything: the row's
 * `time` is the receive time for every sample, and `at` is stored beside it in
 * `telemetry.point_values.device_time`, unclamped. So `at`'s only job is to say
 * what the device claimed, and `F3.16` reads that distinction off the column
 * rather than having to infer it. The pilot RTU makes the point concrete: its
 * clock ran ~34 minutes ahead of the server on 2026-08-06, and the `F1.7` fleet
 * probe later measured a 3 h 37 m spread across nine RTUs.
 */
export function parseMqttEnvelope(raw: string): {
  devId: string;
  values: Record<string, unknown>;
  at?: Date;
} {
  const body = JSON.parse(raw) as Record<string, unknown>;
  const devId = String(body.dev_id ?? "");
  const nested =
    body.values !== null && body.values !== undefined && typeof body.values === "object"
      ? (body.values as Record<string, unknown>)
      : undefined;
  const values =
    nested === undefined ? readingFields(body) : { ...readingFields(body), ...nested };

  if (body.ts === undefined || body.ts === null) {
    return { devId, values };
  }
  const tsMs = Number(body.ts);
  if (!Number.isFinite(tsMs)) {
    return { devId, values };
  }
  const at = new Date(tsMs);
  return Number.isFinite(at.getTime()) ? { devId, values, at } : { devId, values };
}
