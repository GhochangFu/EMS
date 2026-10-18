import {
  MQTT_DISCOVERY_DEV_ID_MAX,
  MQTT_DISCOVERY_MAX_DEVICES,
  MQTT_DISCOVERY_MAX_KEYS_PER_DEVICE,
  MQTT_DISCOVERY_MAX_MESSAGES,
  MQTT_DISCOVERY_MAX_PAYLOAD_BYTES,
  MQTT_DISCOVERY_MAX_TOTAL_KEYS,
  MQTT_DISCOVERY_SAMPLE_STRING_MAX,
  MQTT_DISCOVERY_SOURCE_KEY_MAX,
  MQTT_DISCOVERY_TOPIC_MAX,
  type OnboardingDiscoveryDevice,
  type OnboardingDiscoveryKey,
  parseMqttEnvelope,
} from "@bms/shared";

import { isSecretKey } from "../admin/onboarding/onboarding-redaction";
import { looksLikeCredential } from "../security/credential-detect";

/**
 * `F3.24b` (ADR 0103 decisions 5 and 6; decisions Q2; security review H2) —
 * groups what one discovery window receives by topic → `dev_id` → keys.
 * Pure: no I/O, no clock.
 *
 * **Caps, in order per message.** A payload over 256 KiB is counted and
 * skipped. Past 5,000 parsed messages the next one truncates and stops. A
 * payload that is not an envelope (bad JSON, no `dev_id`) is skipped. A new
 * `(topic, devId)` past 200 devices truncates and stops. Past 500 keys on one
 * device a new key truncates that device only. Past 5,000 keys in total a
 * new key truncates and stops (decisions Q2: the stored result stays well
 * under 1 MB). `stopped` tells the job to disconnect at the first cap.
 *
 * **Every wire string is untrusted (H2).** Anyone who can publish to the
 * customer's broker writes the topic, the `dev_id`, the keys and the samples,
 * and the onboarding agent reads them. So C0/C1 controls and the Unicode line
 * separators are stripped from each; a topic over 255, a `dev_id` over 128 or
 * a key over 128 characters is skipped (none could be stored in the draft);
 * a topic, `dev_id` or key that `looksLikeCredential` or holds the broker's
 * own username or password is skipped; a sample that does, or whose key
 * `isSecretKey`, is `"<redacted>"`.
 */

export type CollectorCaps = {
  readonly maxMessages: number;
  readonly maxPayloadBytes: number;
  readonly maxDevices: number;
  readonly maxKeysPerDevice: number;
  readonly maxTotalKeys: number;
  readonly sampleStringMax: number;
  readonly topicMax: number;
  readonly devIdMax: number;
  readonly sourceKeyMax: number;
};

export const DISCOVERY_CAPS: CollectorCaps = {
  maxMessages: MQTT_DISCOVERY_MAX_MESSAGES,
  maxPayloadBytes: MQTT_DISCOVERY_MAX_PAYLOAD_BYTES,
  maxDevices: MQTT_DISCOVERY_MAX_DEVICES,
  maxKeysPerDevice: MQTT_DISCOVERY_MAX_KEYS_PER_DEVICE,
  maxTotalKeys: MQTT_DISCOVERY_MAX_TOTAL_KEYS,
  sampleStringMax: MQTT_DISCOVERY_SAMPLE_STRING_MAX,
  topicMax: MQTT_DISCOVERY_TOPIC_MAX,
  devIdMax: MQTT_DISCOVERY_DEV_ID_MAX,
  sourceKeyMax: MQTT_DISCOVERY_SOURCE_KEY_MAX,
};

export const REDACTED = "<redacted>";

export type CollectorResult = {
  readonly devices: OnboardingDiscoveryDevice[];
  readonly truncated: boolean;
  /** Messages parsed and grouped. */
  readonly messages: number;
  /** Messages counted and dropped: oversize, not an envelope, an unusable topic or `dev_id`. */
  readonly skipped: number;
  /** Keys counted and dropped: empty, over 128 characters, or credential-looking. */
  readonly skippedKeys: number;
  /** Keys stored across all devices. */
  readonly keys: number;
};

export type DiscoveryCollector = {
  offer(topic: string, payload: Uint8Array | string): void;
  /** True once a cap that ends the job was reached. */
  readonly stopped: boolean;
  result(): CollectorResult;
};

/** C0 and C1 controls, DEL, and the Unicode line and paragraph separators. */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export function stripUnsafe(value: string): string {
  return value.replace(UNSAFE_CHARS, "");
}

type Device = { topic: string; devId: string; messageCount: number; keys: Map<string, OnboardingDiscoveryKey["sampleValue"]> };

export function createDiscoveryCollector(opts: {
  caps?: Partial<CollectorCaps>;
  /** The decrypted broker username and password: never stored, never echoed. */
  secrets?: readonly string[];
}): DiscoveryCollector {
  const caps: CollectorCaps = { ...DISCOVERY_CAPS, ...opts.caps };
  const secrets = (opts.secrets ?? []).filter((s) => s.length > 0);
  const devices = new Map<string, Device>();
  let stopped = false;
  let truncated = false;
  let messages = 0;
  let skipped = 0;
  let skippedKeys = 0;
  let totalKeys = 0;

  const holdsSecret = (s: string): boolean =>
    secrets.some((secret) => s === secret || (secret.length >= 8 && s.includes(secret)));
  const untrusted = (s: string): boolean => looksLikeCredential(s) || holdsSecret(s);

  const sampleOf = (key: string, raw: unknown): OnboardingDiscoveryKey["sampleValue"] => {
    if (isSecretKey(key)) {
      return REDACTED;
    }
    if (typeof raw === "number") {
      return Number.isFinite(raw) ? raw : "number";
    }
    if (typeof raw === "boolean") {
      return raw;
    }
    if (typeof raw === "string") {
      if (untrusted(raw)) {
        return REDACTED;
      }
      const clean = stripUnsafe(raw).slice(0, caps.sampleStringMax);
      return untrusted(clean) ? REDACTED : clean;
    }
    return raw === null ? "null" : typeof raw;
  };

  const halt = (): void => {
    truncated = true;
    stopped = true;
  };

  function offer(rawTopic: string, payload: Uint8Array | string): void {
    if (stopped) {
      return;
    }
    const bytes = typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : payload.byteLength;
    if (bytes > caps.maxPayloadBytes) {
      skipped += 1;
      return;
    }
    if (messages >= caps.maxMessages) {
      halt();
      return;
    }
    const topic = stripUnsafe(rawTopic);
    if (topic.length === 0 || topic.length > caps.topicMax || untrusted(topic)) {
      skipped += 1;
      return;
    }
    let envelope: { devId: string; values: Record<string, unknown> };
    try {
      envelope = parseMqttEnvelope(typeof payload === "string" ? payload : new TextDecoder().decode(payload));
    } catch {
      skipped += 1;
      return;
    }
    const devId = stripUnsafe(envelope.devId).trim();
    if (devId.length === 0 || devId.length > caps.devIdMax || untrusted(devId)) {
      skipped += 1;
      return;
    }
    const id = `${topic}\u0000${devId}`;
    let device = devices.get(id);
    if (device === undefined) {
      if (devices.size >= caps.maxDevices) {
        halt();
        return;
      }
      device = { topic, devId, messageCount: 0, keys: new Map() };
      devices.set(id, device);
    }
    device.messageCount += 1;
    messages += 1;

    for (const [rawKey, value] of Object.entries(envelope.values)) {
      const key = stripUnsafe(rawKey);
      if (key.length === 0 || key.length > caps.sourceKeyMax || untrusted(key)) {
        skippedKeys += 1;
        continue;
      }
      if (device.keys.has(key)) {
        device.keys.set(key, sampleOf(key, value));
        continue;
      }
      if (device.keys.size >= caps.maxKeysPerDevice) {
        truncated = true;
        continue;
      }
      if (totalKeys >= caps.maxTotalKeys) {
        halt();
        return;
      }
      device.keys.set(key, sampleOf(key, value));
      totalKeys += 1;
    }
  }

  return {
    offer,
    get stopped() {
      return stopped;
    },
    result: () => ({
      devices: [...devices.values()].map((d) => ({
        topic: d.topic,
        devId: d.devId,
        messageCount: d.messageCount,
        keys: [...d.keys].map(([sourceKey, sampleValue]) => ({ sourceKey, sampleValue })),
      })),
      truncated,
      messages,
      skipped,
      skippedKeys,
      keys: totalKeys,
    }),
  };
}
