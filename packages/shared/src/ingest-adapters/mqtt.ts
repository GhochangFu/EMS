import { z } from "zod";

// A runtime import of the module that re-exports this one (`ingest.ts` has
// `export * from "./ingest-adapters/mqtt"`). The cycle is safe: the predicate is
// read only inside the `refine` callback, at parse time, never while either
// module is still loading.
import { mqttTopicHasWildcard } from "../ingest";

/**
 * The MQTT adapter's config and device schemas (ADR 0016 §6), and the onboarding
 * draft schema derived from them (ADR 0093 decision 4, `F3.24a`).
 *
 * `mqttConfigSchema`, `MqttConfig`, `mqttDeviceSchema` and `MqttDevice` moved here
 * unchanged from `apps/ingest/src/adapters/mqtt.ts`, so the ingest adapter, the
 * onboarding validator and the onboarding tools read one schema and cannot
 * disagree on what an MQTT RTU config is. The adapter imports them from
 * `@bms/shared/ingest`; nothing re-exports them from `apps/ingest`.
 */

/** Connection-level config. Non-secret by definition — credentials arrive separately. */
export const mqttConfigSchema = z.object({
  /** Broker hostname. Supplied by the host, which owns the pilot's env fallback (§4). */
  host: z.string().min(1),
  /** Broker TLS port; 8883 for the PHE pilot. */
  port: z.number().int().positive(),
  /**
   * TLS peer verification. Defaults to on, matching `index.js`'s
   * `MQTT_TLS_REJECT_UNAUTHORIZED !== "false"`. The host reads that env var —
   * the adapter must not (§4).
   */
  rejectUnauthorized: z.boolean().default(true),
});

export type MqttConfig = z.infer<typeof mqttConfigSchema>;

/** Per-device config. `topic` comes from the `bms.rtus.mqtt_topic` shim until it is backfilled (§3). */
export const mqttDeviceSchema = z.object({
  /**
   * The ThinkIoT topic this RTU publishes on, e.g. `Airsprint-1051/Data/<devid>`.
   *
   * Wildcards are rejected. This is one *device's* topic, so `#` or `+` is
   * always a mistake — and `topic: "#"` would subscribe to the entire broker,
   * firehosing the bounded sample queue until its drop-oldest policy started
   * discarding genuine PHE readings.
   *
   * `F4.221`: the predicate is `@bms/shared`'s, so the admin RTU routes and the
   * onboarding agent refuse exactly what this refuses.
   */
  topic: z
    .string()
    .min(1)
    .refine((topic) => !mqttTopicHasWildcard(topic), {
      message: "a device topic must name one device, not a wildcard subscription",
    }),
});

export type MqttDevice = z.infer<typeof mqttDeviceSchema>;

/**
 * The fixed refusal for a draft that sets `rejectUnauthorized` (ADR 0093, `F3.24a`
 * plan Q1). The ingest host skips an MQTT RTU whose stored config has an own
 * `rejectUnauthorized` key, whatever its value (`tls-downgrade-refused`), so a
 * draft that carried one would commit an RTU ingest never serves.
 */
export const MQTT_REJECT_UNAUTHORIZED_DRAFT_MESSAGE =
  "rejectUnauthorized is set by the ingest host's environment, not by the draft; remove it";

/**
 * An onboarding draft topic: one device's topic, or `""` — the guided MQTT add
 * writes an empty topic and asks for it on the next turn.
 */
const draftTopic = z.union([z.literal(""), mqttDeviceSchema.shape.topic]);

/**
 * The schema the onboarding validator and tools apply to an MQTT RTU's
 * `rtus[].config` (ADR 0093 decision 4).
 *
 * Looser than ingest in one place: `host` and `port` may be absent, because the
 * ingest host's env fallback (`resolveMqttConnection`) supplies them. Every
 * present field is checked with the shared schema's own field. `.passthrough()`:
 * `tls` and other draft-only keys are kept, not stripped.
 *
 * Every issue message is fixed text — none echoes the offending value (§9.6),
 * because the validator and the tools forward these messages.
 */
export const mqttDraftConfigSchema = z
  .object({
    host: mqttConfigSchema.shape.host.optional(),
    port: mqttConfigSchema.shape.port.optional(),
    topic: draftTopic.optional(),
    mqttTopic: draftTopic.optional(),
    device: z
      .object({ topic: mqttDeviceSchema.shape.topic.optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .superRefine((config, ctx) => {
    if (Object.prototype.hasOwnProperty.call(config, "rejectUnauthorized")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejectUnauthorized"],
        message: MQTT_REJECT_UNAUTHORIZED_DRAFT_MESSAGE,
      });
    }
  });
