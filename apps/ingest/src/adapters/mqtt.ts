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
 * `parsePayload()` from `index.js:111-119`, with one deliberate change.
 *
 * Legacy defaults a missing `ts` to `Date.now()`. Under the new contract `at`
 * is set **only** where the protocol genuinely carries a device timestamp, and
 * the host substitutes receive time otherwise (`SourceSample.at`). Those two
 * behaviours agree to within the handful of milliseconds between receipt and
 * parsing — but the second one is honest about which clock produced the value,
 * and `F3.16` reads that distinction.
 */
export function parsePayload(raw: string): {
  devId: string;
  values: Record<string, unknown>;
  at?: Date;
} {
  const body = JSON.parse(raw) as Record<string, unknown>;
  const devId = String(body.dev_id ?? "");
  const values =
    body.values !== null && body.values !== undefined && typeof body.values === "object"
      ? (body.values as Record<string, unknown>)
      : body;

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

  function handleMessage(_topic: string, payload: Buffer): void {
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
      for (const binding of ctx.bindings) {
        sourceKeysByDevice.set(binding.deviceKey, binding.sourceKeys);
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
        // jitter — and an adapter owns no timer (rule 4). `index.js` sets
        // `reconnectPeriod: MQTT_RECONNECT_MS ?? 5000`; leaving that on would
        // mean two reconnect policies racing, and the supervisor could never
        // observe a disconnection it was supposed to manage.
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
