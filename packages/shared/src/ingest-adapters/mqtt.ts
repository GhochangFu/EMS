import { z } from "zod";

// The leaf module, not `../ingest`: that module re-exports this one, and a
// runtime import back from it would make the catalog depend on entry order.
import { mqttTopicHasWildcard } from "../mqtt-topic";
import { mqttPayloadFormatCodeSchema, mqttPayloadFormatDefinitionSchema } from "./mqtt-payload-format";

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
  /**
   * TLS on the broker connection (ADR 0114 decision 2, `F4.326`). Absent means
   * on, so every RTU committed before ADR 0114 keeps its behaviour. Only the
   * literal `false` asks for plain `mqtt://`, and the ingest host serves that
   * only when the broker host is on the operator's `MQTT_PLAINTEXT_HOSTS`
   * (`mqttPlaintextDecision` below); an unlisted host is skipped, never
   * connected with TLS instead.
   */
  tls: z.boolean().default(true),
  /**
   * The catalog code of the payload format this RTU publishes in (ADR 0116
   * decisions 2 and 4, `F4.334`). Absent means the built-in
   * `thinkiot-envelope`, so every RTU committed before ADR 0116 keeps its
   * behaviour. The ingest host joins the catalog by this code; a code with no
   * catalog row is skipped (`payload-format-unknown`), never decoded as the
   * built-in instead.
   */
  payloadFormat: mqttPayloadFormatCodeSchema.optional(),
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
  /**
   * The payload format this device's topic decodes with (ADR 0116 decision 4).
   * Set by the ingest host from the catalog join, **never** from stored JSON:
   * the host overwrites the key on every plan. Absent means the built-in envelope.
   */
  payloadFormat: z
    .object({ code: mqttPayloadFormatCodeSchema, definition: mqttPayloadFormatDefinitionSchema })
    .strict()
    .optional(),
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

/** The environment variable that names the plain-MQTT broker hosts (ADR 0114 decision 1). */
export const MQTT_PLAINTEXT_HOSTS_ENV = "MQTT_PLAINTEXT_HOSTS";

/**
 * A bad `MQTT_PLAINTEXT_HOSTS` entry. A boot refusal in every process that reads
 * the variable (ADR 0114 decision 1; plan ruling 10). The message names the
 * entry's **position**, never its text (plan R2), so a mistyped secret pasted
 * into the variable never reaches a log line.
 */
export class MqttPlaintextHostsConfigError extends Error {
  constructor(position: number) {
    super(`${MQTT_PLAINTEXT_HOSTS_ENV} entry ${position} is not a host name`);
    this.name = "MqttPlaintextHostsConfigError";
  }
}

/**
 * One DNS label: letters, digits and inner hyphens, 1–63 characters. A dotted
 * IPv4 literal is a run of such labels and passes; `:` (a port or IPv6), `/`,
 * `@`, `*`, `[`, `]` and whitespace can never appear (plan ruling 9).
 */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isHostName(entry: string): boolean {
  return entry.length <= 253 && entry.split(".").every((label) => HOST_LABEL.test(label));
}

/**
 * Parses `MQTT_PLAINTEXT_HOSTS` (ADR 0114 decision 1, plan R2).
 *
 * Comma-separated; each entry trimmed and lower-cased; empty entries ignored.
 * Unset or blank is the empty set, which is today's behaviour: no host may
 * connect plain. An entry that is not a host name throws
 * `MqttPlaintextHostsConfigError` — one parser for `apps/ingest`, `apps/api`
 * and the worker, so the three processes cannot disagree.
 */
export function parseMqttPlaintextHosts(raw: string | undefined): ReadonlySet<string> {
  const hosts = new Set<string>();
  if (raw === undefined) {
    return hosts;
  }
  const entries = raw.split(",");
  entries.forEach((rawEntry, index) => {
    const entry = rawEntry.trim().toLowerCase();
    if (entry === "") {
      return;
    }
    if (!isHostName(entry)) {
      throw new MqttPlaintextHostsConfigError(index + 1);
    }
    hosts.add(entry);
  });
  return hosts;
}

/**
 * How one MQTT RTU connects (ADR 0114 rulings Q1–Q3).
 *
 * - `"tls"` — `tls` is anything but the literal `false` (absent, `true`, the
 *   string `"false"`, …). The list alone never selects plain.
 * - `"plain"` — `tls === false` and the lower-cased host is on the list.
 * - `"refused"` — `tls === false` and the host is absent or unlisted. The
 *   caller refuses; it never falls back to TLS.
 *
 * The match is exact on the lower-cased host: no wildcard, no port, no range.
 */
export function mqttPlaintextDecision(
  tls: unknown,
  host: string | undefined,
  allowed: ReadonlySet<string>,
): "tls" | "plain" | "refused" {
  if (tls !== false) {
    return "tls";
  }
  if (host === undefined || host === "") {
    return "refused";
  }
  return allowed.has(host.toLowerCase()) ? "plain" : "refused";
}

/**
 * The fixed refusal for a plain-MQTT RTU whose host is not on the list (ADR 0114
 * decision 5). Names no host (§9.6, the validator's fixed-text rule).
 */
export const MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE =
  "Plain MQTT is not allowed for this broker host; ask the operator to add it to MQTT_PLAINTEXT_HOSTS";

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
 * present field is checked with the shared schema's own field. `tls` is a real
 * config field since ADR 0114 (decision 2): checked as a boolean, so the string
 * `"false"` is a schema issue rather than a silent TLS connect. Whether a
 * `tls: false` draft may commit is the validator's check against
 * `MQTT_PLAINTEXT_HOSTS`, not this schema's. `.passthrough()` keeps the keys,
 * and since `F4.339` (ADR 0117 decision 10) every key outside
 * `MQTT_DRAFT_CONFIG_KEYS` is an issue with a fixed hint.
 *
 * Every issue message is fixed text — none echoes the offending value (§9.6),
 * because the validator and the tools forward these messages.
 */
/** `F4.339` (plan R9): the keys an MQTT draft config may carry; `rejectUnauthorized` has its own refusal above. */
export const MQTT_DRAFT_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "host",
  "port",
  "tls",
  "payloadFormat",
  "topic",
  "mqttTopic",
  "device",
  "rejectUnauthorized",
]);

export const MQTT_CONFIG_HOST_HINT = "use host for the broker host";
export const MQTT_CONFIG_DEVICE_KEY_HINT = "the device key is the RTU's rtuCode, not a config key";
export const MQTT_CONFIG_UNKNOWN_KEY_HINT = "unknown MQTT config key; the config takes host, port, tls, topic, payloadFormat";

/** The fixed hint for an unknown MQTT draft config key: two known mistakes, then the generic sentence. */
export function mqttDraftConfigKeyHint(key: string): string {
  if (["brokerHost", "broker", "hostname", "url"].includes(key)) return MQTT_CONFIG_HOST_HINT;
  if (["devId", "dev_id", "deviceId", "device_id"].includes(key)) return MQTT_CONFIG_DEVICE_KEY_HINT;
  return MQTT_CONFIG_UNKNOWN_KEY_HINT;
}

export const mqttDraftConfigSchema = z
  .object({
    host: mqttConfigSchema.shape.host.optional(),
    port: mqttConfigSchema.shape.port.optional(),
    tls: z.boolean().optional(),
    // ADR 0116 decision 4: the catalog code; whether it names a catalog row is
    // the validator's check, not this schema's.
    payloadFormat: mqttConfigSchema.shape.payloadFormat,
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
    // F4.339 (ADR 0117 decision 10, plan R9): an unknown key is refused at its
    // own path with a fixed hint — never the value. The issue's path names the
    // key; the message does not echo it.
    for (const key of Object.keys(config)) {
      if (!MQTT_DRAFT_CONFIG_KEYS.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: mqttDraftConfigKeyHint(key) });
      }
    }
  });
