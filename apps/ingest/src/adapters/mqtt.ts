import mqtt from "mqtt";

import {
  mqttConfigSchema,
  mqttDeviceSchema,
  parseMqttEnvelope as parsePayload,
} from "@bms/shared/ingest";
import type { AdapterHealth, MqttConfig, MqttDevice, SourceSample } from "@bms/shared/ingest";

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
 *
 * The config and device schemas it parses with (`mqttConfigSchema`,
 * `mqttDeviceSchema`) live in `@bms/shared/ingest` since `F3.24a` (ADR 0093
 * decision 4), so onboarding checks a draft with the same schema.
 */

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

// `F3.24b`: the envelope parse moved to `@bms/shared/ingest` so discovery reads the same
// function (ADR 0103). Re-exported under the old name for this file and its spec.
export { parsePayload };

/** Bound keys one payload yielded no reading for, each list in binding order (`F4.58`). */
export type AbsentReadings = {
  /** Carried as `null`, `""`, or a value that will not coerce to a finite number. */
  readonly empty: readonly string[];
  /** Not carried at all (`undefined`). */
  readonly missing: readonly string[];
};

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
 *
 * **Absent, but no longer silent (`F4.58`).** Every bound key that yields no
 * sample is classified into `absent`, in binding order: `missing` when the
 * payload never carried the key (`undefined` — typically a wrong mapping), and
 * `empty` when it carried `null`, `""` or a value that will not coerce to a
 * finite number (typically a dead meter). ADR 0016 §5 rule 7 says drop *and
 * count*, and rule 9 forbids swallowing silently; the bare `continue` here did
 * both. `handleMessage` reports the classification through `context.logger`.
 */
export function samplesFromPayload(
  parsed: { devId: string; values: Record<string, unknown>; at?: Date },
  sourceKeys: readonly string[],
): { samples: SourceSample[]; absent: AbsentReadings } {
  const samples: SourceSample[] = [];
  const empty: string[] = [];
  const missing: string[] = [];
  for (const sourceKey of sourceKeys) {
    const raw = parsed.values[sourceKey];
    if (raw === undefined) {
      missing.push(sourceKey);
      continue;
    }
    if (raw === null || raw === "") {
      empty.push(sourceKey);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      empty.push(sourceKey);
      continue;
    }
    samples.push(
      parsed.at === undefined
        ? { sourceKey, value, deviceKey: parsed.devId }
        : { sourceKey, value, deviceKey: parsed.devId, at: parsed.at },
    );
  }
  return { samples, absent: { empty, missing } };
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

  /**
   * `devId → { rtuCode, sourceKeys }`, so a message is routed without rescanning
   * bindings. `rtuCode` is carried for the `readings absent` line (`F4.58`).
   */
  const bindingByDevice = new Map<string, { rtuCode: string; sourceKeys: readonly string[] }>();
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

    const binding = bindingByDevice.get(parsed.devId);
    if (binding === undefined) {
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

    const { samples, absent } = samplesFromPayload(parsed, binding.sourceKeys);
    // F4.58 (ADR 0016 §5 rules 7 and 9): a bound key that yields no reading is
    // reported, not dropped silently. After the topic guard, so the line only
    // ever speaks for a station the payload was entitled to speak for; before
    // the early return, so an all-absent message is reported too. One line per
    // message, stateless and timer-free (rule 4). Ids and counts only — never a
    // value (AGENTS.md §9.6).
    if (absent.empty.length > 0 || absent.missing.length > 0) {
      context?.logger.warn("readings absent", {
        rtuCode: binding.rtuCode,
        deviceKey: parsed.devId,
        empty: absent.empty.length,
        missing: absent.missing.length,
        ...(absent.empty.length === 0 ? {} : { firstEmpty: absent.empty[0] }),
        ...(absent.missing.length === 0 ? {} : { firstMissing: absent.missing[0] }),
      });
    }
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
      bindingByDevice.clear();
      deviceKeysByTopic.clear();
      for (const binding of ctx.bindings) {
        bindingByDevice.set(binding.deviceKey, {
          rtuCode: binding.rtuCode,
          sourceKeys: binding.sourceKeys,
        });
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
