/**
 * `F3.24b` / ADR 0103 — live MQTT discovery for the onboarding agent: the
 * route body, the result the session DTO carries, and the shape the worker
 * stores in `draft._discovery`.
 *
 * **Flat `z.object(...).strict()` throughout** — no `z.intersection`, no
 * `.readonly()`, as `copilot.ts` does. `.strict()` is what keeps a stray key
 * (a credential, a stored-only counter) out of the DTO at the client edge.
 *
 * **No import from `./onboarding`.** `onboarding.ts` imports this file for
 * `onboardingSessionDtoSchema.discovery`, so importing back would be a cycle
 * that reads a constant before it exists. The three bounds below are therefore
 * restated, and `onboarding-discovery.spec.ts` asserts each equals the
 * `onboarding.ts` constant it mirrors.
 *
 * **Two shapes, one mapping (accuracy review #4).** The worker stores
 * `onboardingDiscoveryStoredSchema` (the DTO plus `queuedAt` and the collector's
 * counters). `discoveryDtoOf` maps it to the DTO. A strict DTO that was also the
 * stored shape would fail `safeParse` on `queuedAt` and every stored discovery
 * would read as `null`.
 */
import { z } from "zod";

import { mqttTopicHasWildcard } from "../mqtt-topic";

export const MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS = 60;
export const MQTT_DISCOVERY_MAX_WINDOW_SECONDS = 120;
export const MQTT_DISCOVERY_MIN_WINDOW_SECONDS = 5;
export const MQTT_DISCOVERY_MAX_MESSAGES = 5_000;
export const MQTT_DISCOVERY_MAX_PAYLOAD_BYTES = 256 * 1024;
export const MQTT_DISCOVERY_MAX_DEVICES = 200;
export const MQTT_DISCOVERY_MAX_KEYS_PER_DEVICE = 500;
/** Decisions Q2: a total-keys cap per job, so the stored result stays well under 1 MB. */
export const MQTT_DISCOVERY_MAX_TOTAL_KEYS = 5_000;
export const MQTT_DISCOVERY_SAMPLE_STRING_MAX = 64;
/** The width of `bms.rtus.mqtt_topic` — mirrors `MAX_RTU_TOPIC_CHARS`. */
export const MQTT_DISCOVERY_TOPIC_MAX = 255;
/** A device id is bounded on the wire (security review H2). */
export const MQTT_DISCOVERY_DEV_ID_MAX = 128;
/** Mirrors `ONBOARDING_DRAFT_STRING_MAX["assetPoints.sourceDataKey"]`. */
export const MQTT_DISCOVERY_SOURCE_KEY_MAX = 128;
/** Mirrors `ONBOARDING_DRAFT_STRING_MAX["rtus.code"]`. */
export const MQTT_DISCOVERY_RTU_CODE_MAX = 64;

/** The one sentence the card and the Discover button both show (drafter choice 6). */
export const MQTT_DISCOVERY_SHARED_USER_WARNING =
  "If this broker allows one connection per user, use a separate username for discovery.";

/** Fixed messages: a refused prefix is never echoed back (AGENTS.md §9.6). */
export const startOnboardingDiscoveryBodySchema = z
  .object({
    rtuCode: z.string().trim().min(2).max(MQTT_DISCOVERY_RTU_CODE_MAX),
    topicPrefix: z
      .string()
      .min(1)
      .max(MQTT_DISCOVERY_TOPIC_MAX)
      .refine((p) => !mqttTopicHasWildcard(p), { message: "topicPrefix must not hold a wildcard" })
      .refine((p) => !p.startsWith("$"), { message: "topicPrefix must not start with $" }),
    windowSeconds: z
      .number()
      .int()
      .min(MQTT_DISCOVERY_MIN_WINDOW_SECONDS)
      .max(MQTT_DISCOVERY_MAX_WINDOW_SECONDS)
      .optional(),
  })
  .strict();

export const onboardingDiscoveryStatusSchema = z.enum(["queued", "running", "done", "failed"]);

export const onboardingDiscoveryErrorClassSchema = z.enum([
  "auth refused",
  "host unreachable",
  "TLS failed",
  "timeout",
  "blocked host",
]);

export const onboardingDiscoveryKeySchema = z
  .object({
    sourceKey: z.string().max(MQTT_DISCOVERY_SOURCE_KEY_MAX),
    sampleValue: z.union([
      z.number(),
      z.boolean(),
      z.string().max(MQTT_DISCOVERY_SAMPLE_STRING_MAX),
    ]),
  })
  .strict();

export const onboardingDiscoveryDeviceSchema = z
  .object({
    topic: z.string().max(MQTT_DISCOVERY_TOPIC_MAX),
    devId: z.string().max(MQTT_DISCOVERY_DEV_ID_MAX),
    messageCount: z.number().int(),
    keys: z.array(onboardingDiscoveryKeySchema).max(MQTT_DISCOVERY_MAX_KEYS_PER_DEVICE),
  })
  .strict();

export const onboardingDiscoveryResultDtoSchema = z
  .object({
    discoveryId: z.string().uuid(),
    rtuCode: z.string().max(MQTT_DISCOVERY_RTU_CODE_MAX),
    // `<prefix>/#`: the prefix bound plus the two-character suffix.
    topicFilter: z.string().max(MQTT_DISCOVERY_TOPIC_MAX + 2),
    windowSeconds: z.number().int(),
    status: onboardingDiscoveryStatusSchema,
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    truncated: z.boolean(),
    error: onboardingDiscoveryErrorClassSchema.optional(),
    devices: z.array(onboardingDiscoveryDeviceSchema).max(MQTT_DISCOVERY_MAX_DEVICES),
  })
  .strict();

/**
 * What the worker and the route write into `draft._discovery`: the DTO plus
 * `queuedAt` (the busy check's clock) and the collector's counters.
 */
export const onboardingDiscoveryStoredSchema = z
  .object({
    discoveryId: z.string().uuid(),
    rtuCode: z.string().max(MQTT_DISCOVERY_RTU_CODE_MAX),
    topicFilter: z.string().max(MQTT_DISCOVERY_TOPIC_MAX + 2),
    windowSeconds: z.number().int(),
    status: onboardingDiscoveryStatusSchema,
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    truncated: z.boolean(),
    error: onboardingDiscoveryErrorClassSchema.optional(),
    devices: z.array(onboardingDiscoveryDeviceSchema).max(MQTT_DISCOVERY_MAX_DEVICES),
    queuedAt: z.string(),
    /** Messages the collector accepted and parsed. */
    messages: z.number().int(),
    /** Messages it counted and dropped (oversize, bad JSON, no devId, over a cap). */
    skipped: z.number().int(),
  })
  .strict();

export const startOnboardingDiscoveryResponseDtoSchema = z
  .object({ discoveryId: z.string().uuid() })
  .strict();

/** The stored `_discovery` as the DTO the client sees: `queuedAt` and the counters stay server-side. */
export function discoveryDtoOf(
  stored: z.infer<typeof onboardingDiscoveryStoredSchema>,
): z.infer<typeof onboardingDiscoveryResultDtoSchema> {
  const { queuedAt: _queuedAt, messages: _messages, skipped: _skipped, ...dto } = stored;
  return dto;
}
