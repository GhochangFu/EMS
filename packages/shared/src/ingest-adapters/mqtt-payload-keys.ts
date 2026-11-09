import { z } from "zod";

/**
 * The two pieces both MQTT payload format kinds share (ADR 0116, ADR 0119).
 *
 * A leaf module: `mqtt-payload-format.ts` imports the binary module, and the
 * binary module needs the reading-key rule, so the rule lives here and neither
 * of the two imports the other back (an import cycle would leave one schema
 * `undefined` while the other module initialises).
 */

/** Names that would walk into an object's prototype rather than its own data. */
export const MQTT_FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** A reading's key is the `asset_points.source_data_key` it feeds (`varchar(128)`). */
export const mqttPayloadReadingKeySchema = z
  .string()
  .min(1)
  .max(128)
  .refine((key) => !MQTT_FORBIDDEN_SEGMENTS.has(key), {
    message: "a reading key may not name a prototype property",
  });
