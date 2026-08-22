import { z } from "zod";

import mqtt from "mqtt";

import type { AdapterHealth, SourceSample } from "@bms/shared/ingest";

import type {
  AdapterContext,
  IngestAdapterFactory,
  PushIngestAdapter,
} from "../adapter/types.js";

/**
 * The MQTT adapter (ADR 0016 §6, commit 2).
 *
 * Its body is `parsePayload()` and the `mqtt.connect()` block **lifted out of
 * `apps/ingest/src/index.js` with their logic intact** — not redesigned. The
 * ADR's four-to-five-unit estimate assumes a lift, and the live PHE pilot runs
 * on this parsing today; a rewrite would put the one working adapter at risk to
 * no purpose.
 *
 * What genuinely changes is what the adapter *stops* doing: no Postgres, no
 * point-key resolution, no NOTIFY, no `process.env`, and no reconnect timer.
 * All of that is the host's (§2, §5).
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

/**
 * Largest payload this adapter will parse, in bytes.
 *
 * ADR 0016 §5 rule 6: an adapter must not "block the event loop: … no unbounded
 * synchronous parse of an arbitrarily large payload". `JSON.parse` is
 * synchronous, and the host now multiplexes **every** endpoint into one process
 * — so a multi-megabyte message from anyone able to publish on a subscribed
 * topic would stall not just this connection but every other supervisor's drain
 * loop and connect timer, well past the one-endpoint blast radius §5 sets as
 * the acceptance criterion. `index.js` had the same parse but hosted exactly
 * one connection.
 *
 * 256 KiB is far above any real ThinkIoT frame (a few hundred bytes) and far
 * below anything that takes measurable time to parse.
 */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

/** Per-device config. `topic` comes from the `bms.rtus.mqtt_topic` shim until it is backfilled (§3). */
export const mqttDeviceSchema = z.object({
  /**
   * The ThinkIoT topic this RTU publishes on, e.g. `Airsprint-1051/Data/<devid>`.
   *
   * Wildcards are rejected. This is one *device's* topic, so `#` or `+` is
   * always a mistake — and `topic: "#"` would subscribe to the entire broker,
   * firehosing the bounded sample queue until its drop-oldest policy started
   * discarding genuine PHE readings.
   */
  topic: z
    .string()
    .min(1)
    .refine((topic) => !topic.includes("#") && !topic.includes("+"), {
      message: "a device topic must name one device, not a wildcard subscription",
    }),
});

export type MqttDevice = z.infer<typeof mqttDeviceSchema>;

/** The slice of an MQTT client this adapter uses. A fake satisfies it in tests. */
export type MqttClientHandle = {
  on(event: "connect", handler: () => void): void;
  on(event: "message", handler: (topic: string, payload: Buffer) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: "close", handler: () => void): void;
  subscribe(topic: string, options: { qos: 0 }): void;
  end(force: boolean, options: Record<string, never>, callback: () => void): void;
};

export type MqttConnectOptions = {
  username?: string;
  password?: string;
  rejectUnauthorized: boolean;
  reconnectPeriod: number;
};

/** Injected so the adapter is testable without a broker (ADR 0016 §9). */
export type MqttTransport = {
  connect(url: string, options: MqttConnectOptions): MqttClientHandle;
};

const realTransport: MqttTransport = {
  connect(url, options) {
    return mqtt.connect(url, options) as unknown as MqttClientHandle;
  },
};

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
 * genuinely carries a device timestamp, and the host substitutes receive time
 * otherwise (`SourceSample.at`). Those two behaviours agree to within the
 * handful of milliseconds between receipt and parsing — but the second one is
 * honest about which clock produced the value, and `F3.16` reads that
 * distinction. The pilot RTU makes the point concrete: its clock ran ~34
 * minutes ahead of the server on 2026-08-06.
 */
export function parsePayload(raw: string): {
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

/**
 * Builds the samples one payload yields.
 *
 * Scoped to the binding's `sourceKeys` rather than emitting every key in the
 * payload. `RtuBinding.sourceKeys` exists for exactly this ("adapters may use
 * it to scope a read set"), and it keeps the row count identical to
 * `index.js`, which iterates the mapping and reads
 * `parsed.values[point.sourceDataKey]`.
 *
 * The value guards are the legacy ones verbatim: empty string, null and
 * undefined are absent readings rather than zeroes, and a value that will not
 * coerce to a finite number is not a reading at all.
 */
export function samplesFromPayload(
  parsed: { devId: string; values: Record<string, unknown>; at?: Date },
  sourceKeys: readonly string[],
): SourceSample[] {
  const samples: SourceSample[] = [];
  for (const sourceKey of sourceKeys) {
    const raw = parsed.values[sourceKey];
    if (raw === undefined || raw === null || raw === "") {
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      continue;
    }
    samples.push(
      parsed.at === undefined
        ? { sourceKey, value, deviceKey: parsed.devId }
        : { sourceKey, value, deviceKey: parsed.devId, at: parsed.at },
    );
  }
  return samples;
}

/**
 * The named factory §7 asks every adapter to export: production calls it with
 * no argument, tests pass a fake transport.
 */
export function createMqttAdapter(
  transport: MqttTransport = realTransport,
): PushIngestAdapter<MqttConfig, MqttDevice> {
  let client: MqttClientHandle | null = null;
  let context: AdapterContext<MqttConfig, MqttDevice> | null = null;
  let emit: ((samples: readonly SourceSample[]) => void) | null = null;
  let state: AdapterHealth["state"] = "disconnected";
  let detail: string | undefined;
  let lastSampleAt: Date | undefined;
  /** Set by `disconnect()`. Guards rule 8: never emit after disconnect. */
  let closed = false;

  /** `devId → sourceKeys`, so a message is routed without rescanning bindings. */
  const sourceKeysByDevice = new Map<string, readonly string[]>();
  /**
   * `topic → the devIds bound to it`, so a payload may only speak for the topic
   * it arrived on (`F1.7`).
   *
   * **`dev_id` is the payload's own claim, and nothing else vouched for it.**
   * Routing on it alone lets anyone with publish rights on the broker write
   * another station's telemetry — and, since `F1.7` keys liveness per device,
   * refresh that station's `lastSampleAt` so its outage never raises `stale`.
   * One message would both falsify the data and silence the alarm meant to
   * catch it. The topic is what the broker's own ACL governs, so it is the
   * half worth trusting.
   *
   * A `Set` rather than one id: a topic may legitimately serve several devices,
   * which is the case `subscribe()`'s de-duplication exists for.
   *
   * Mutable `Set` internally because `connect()` builds it incrementally; the
   * previous `ReadonlySet` declaration only held by casting the readonly away at
   * the one place that added to it, which is a guarantee that guards nothing.
   * Reads go through `has()`, so nothing outside this closure can mutate it.
   */
  const deviceKeysByTopic = new Map<string, Set<string>>();

  function handleMessage(topic: string, payload: Buffer): void {
    // Rule 8 (§5): nothing is emitted before `subscribe()` resolves or after
    // `disconnect()` is called.
    if (emit === null || closed) {
      return;
    }
    if (payload.length > MAX_PAYLOAD_BYTES) {
      // Checked before `toString`, so an oversized frame is never materialised
      // as a string either (§5 rule 6). Size only — never the content.
      context?.logger.warn("mqtt payload rejected: too large", {
        bytes: payload.length,
        limit: MAX_PAYLOAD_BYTES,
      });
      return;
    }

    let parsed: ReturnType<typeof parsePayload>;
    try {
      parsed = parsePayload(payload.toString("utf8"));
    } catch {
      // A malformed payload is one device misbehaving, not a connection fault.
      // `index.js` returns silently here; this at least counts it in `detail`.
      context?.logger.warn("mqtt payload was not valid JSON", { bytes: payload.length });
      return;
    }

    const sourceKeys = sourceKeysByDevice.get(parsed.devId);
    if (sourceKeys === undefined) {
      // A device publishing on a subscribed topic that this host has no binding
      // for. Ordinary on a shared topic; not an error.
      return;
    }

    // The device is bound *somewhere* — but is it bound to THIS topic? A bound
    // id arriving on another device's topic is impersonation, not a routing
    // quirk, so it is logged rather than dropped quietly. Never echo the
    // payload: the ids are routing, the values are not (AGENTS.md §9.6).
    if (deviceKeysByTopic.get(topic)?.has(parsed.devId) !== true) {
      context?.logger.warn("mqtt payload rejected: device is not bound to this topic", {
        topic,
        devId: parsed.devId,
      });
      return;
    }

    const samples = samplesFromPayload(parsed, sourceKeys);
    if (samples.length === 0) {
      return;
    }
    lastSampleAt = new Date();
    emit(samples);
  }

  return {
    mode: "push",

    async connect(ctx) {
      context = ctx;
      closed = false;
      sourceKeysByDevice.clear();
      deviceKeysByTopic.clear();
      for (const binding of ctx.bindings) {
        sourceKeysByDevice.set(binding.deviceKey, binding.sourceKeys);
        const bound = deviceKeysByTopic.get(binding.device.topic);
        if (bound === undefined) {
          deviceKeysByTopic.set(binding.device.topic, new Set([binding.deviceKey]));
        } else {
          bound.add(binding.deviceKey);
        }
      }

      const url = `mqtts://${ctx.config.host}:${ctx.config.port}`;
      const handle = transport.connect(url, {
        ...(ctx.credentials.username === undefined
          ? {}
          : { username: ctx.credentials.username }),
        ...(ctx.credentials.password === undefined
          ? {}
          : { password: ctx.credentials.password }),
        rejectUnauthorized: ctx.config.rejectUnauthorized,
        // **The library's own reconnect is switched off.** ADR 0016 §5 gives
        // reconnect backoff to the host — exponential, base 1 s, cap 60 s, ±20%
        // jitter — and an adapter owns no timer (rule 4). The ADR 0007 pilot set
        // `reconnectPeriod: MQTT_RECONNECT_MS ?? 5000`; leaving that on would
        // mean two reconnect policies racing, and the supervisor could never
        // observe a disconnection it was supposed to manage. That pilot and its
        // `MQTT_RECONNECT_MS` were both deleted at §6 commit 4.
        reconnectPeriod: 0,
      });
      client = handle;

      handle.on("error", (error: Error) => {
        state = "degraded";
        // The message may name a host or a port; it must never name a
        // credential, so it is not interpolated from `ctx.credentials`.
        detail = error.message;
        ctx.logger.error("mqtt transport error", { endpointKey: ctx.endpointKey });
      });
      handle.on("close", () => {
        if (!closed) {
          state = "disconnected";
          detail = "connection closed";
        }
      });
      handle.on("message", handleMessage);

      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          reject(new Error("aborted before the broker connected"));
        };
        if (ctx.signal.aborted) {
          onAbort();
          return;
        }
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        handle.on("connect", () => {
          ctx.signal.removeEventListener("abort", onAbort);
          state = "connected";
          detail = undefined;
          resolve();
        });
      });
    },

    async subscribe(sink) {
      const ctx = context;
      const handle = client;
      if (ctx === null || handle === null) {
        throw new Error("subscribe() called before connect()");
      }
      // Subscribe to each distinct topic once. `index.js` de-duplicates with a
      // `Set` for the same reason; ADR 0016's Context notes the pilot does not
      // currently exercise it, but a shared topic is the case the endpoint/device
      // split exists for.
      const topics = [...new Set(ctx.bindings.map((binding) => binding.device.topic))];
      for (const topic of topics) {
        handle.subscribe(topic, { qos: 0 });
      }
      // Assigned last: no sample may reach the host before this resolves.
      emit = sink;
    },

    async disconnect() {
      // Idempotent and must not reject (§1).
      closed = true;
      emit = null;
      state = "disconnected";
      const handle = client;
      client = null;
      if (handle === null) {
        return;
      }
      await new Promise<void>((resolve) => {
        try {
          handle.end(true, {}, () => {
            resolve();
          });
        } catch {
          resolve();
        }
      });
    },

    health() {
      // Synchronous, cheap, never throws — callable before connect and after
      // disconnect. `detail` is never derived from `context.credentials`.
      return {
        state,
        ...(detail === undefined ? {} : { detail }),
        ...(lastSampleAt === undefined ? {} : { lastSampleAt }),
      };
    },
  };
}

/** What `registry.ts` files under `mqtt`. */
export const mqttAdapterFactory: IngestAdapterFactory<MqttConfig, MqttDevice> = {
  protocol: "mqtt",
  mode: "push",
  configSchema: mqttConfigSchema,
  deviceSchema: mqttDeviceSchema,
  /**
   * One broker connection serves every RTU on it — which is what `index.js`
   * does today with a single `mqtt.connect()` and a single `on("message")`,
   * routing by `dev_id` inside the handler.
   */
  endpointKey(config) {
    return `${config.host}:${config.port}`;
  },
  /** MQTT cannot browse: there is no way to enumerate topics a device has not published on. */
  create() {
    return createMqttAdapter();
  },
};

export default mqttAdapterFactory;
