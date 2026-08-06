import type {
  AdapterContractFixtures,
  AdapterUnderTest,
} from "../adapter/adapter-contract.spec.js";
import {
  createMqttAdapter,
  MAX_PAYLOAD_BYTES,
  mqttDeviceSchema,
  parsePayload,
  samplesFromPayload,
  type MqttClientHandle,
  type MqttConfig,
  type MqttConnectOptions,
  type MqttDevice,
  type MqttTransport,
} from "./mqtt.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Records what the adapter asked of the broker and lets a test drive it. */
type FakeBroker = {
  transport: MqttTransport;
  connectCalls: { url: string; options: MqttConnectOptions }[];
  subscriptions: string[];
  ended: number;
  fireConnect(): void;
  fireMessage(topic: string, payload: string): void;
  fireError(error: Error): void;
  failNextConnect(): void;
};

function makeFakeBroker(): FakeBroker {
  const connectCalls: { url: string; options: MqttConnectOptions }[] = [];
  const subscriptions: string[] = [];
  const handlers: {
    connect: (() => void)[];
    message: ((topic: string, payload: Buffer) => void)[];
    error: ((error: Error) => void)[];
    close: (() => void)[];
  } = { connect: [], message: [], error: [], close: [] };
  let shouldFail = false;
  const state = { ended: 0 };

  const handle: MqttClientHandle = {
    on(event: string, handler: unknown): void {
      (handlers[event as keyof typeof handlers] as unknown[]).push(handler);
    },
    subscribe(topic: string): void {
      subscriptions.push(topic);
    },
    end(_force: boolean, _options: Record<string, never>, callback: () => void): void {
      state.ended += 1;
      callback();
    },
  } as MqttClientHandle;

  return {
    transport: {
      connect(url, options) {
        connectCalls.push({ url, options });
        if (shouldFail) {
          // A malformed URL or an immediately-refused socket. It surfaces as a
          // rejected `connect()`, never a synchronous throw out of the adapter.
          throw new Error("broker unreachable");
        }
        return handle;
      },
    },
    connectCalls,
    subscriptions,
    get ended() {
      return state.ended;
    },
    fireConnect() {
      for (const handler of handlers.connect) handler();
    },
    fireMessage(topic, payload) {
      for (const handler of handlers.message) handler(topic, Buffer.from(payload, "utf8"));
    },
    fireError(error) {
      for (const handler of handlers.error) handler(error);
    },
    failNextConnect() {
      shouldFail = true;
    },
  };
}

/** What the shared conformance suite needs from the MQTT adapter. */
export const mqttContractFixtures: AdapterContractFixtures<MqttConfig, MqttDevice> = {
  registryKey: "mqtt",
  validConfig: { host: "phe.thinkiot.co.in", port: 8883 },
  // An empty host is the realistic failure: a config row written with the field
  // present but blank, which a `z.string()` without `.min(1)` would wave through.
  invalidConfig: { host: "", port: 8883 },
  validDevice: { topic: "Airsprint-1051/Data/DEV-1" },
  secondDevice: { topic: "Airsprint-1051/Data/DEV-2" },
  create(): AdapterUnderTest<MqttConfig, MqttDevice> {
    const broker = makeFakeBroker();
    const adapter = createMqttAdapter(broker.transport);
    return {
      adapter,
      completeConnect: () => {
        broker.fireConnect();
      },
      failNextConnect: () => {
        broker.failNextConnect();
      },
      deliverSamples: (deviceKey: string) => {
        broker.fireMessage(
          `Airsprint-1051/Data/${deviceKey}`,
          JSON.stringify({ dev_id: deviceKey, values: { flow: 12.5, press: 3.1 }, ts: 1_754_390_000_000 }),
        );
      },
    };
  },
};

/** MQTT-specific behaviour, beyond the shared contract. */
export async function runMqttAdapterTests(): Promise<void> {
  // ---- parsePayload, lifted from index.js ---------------------------------

  {
    const parsed = parsePayload(
      JSON.stringify({ dev_id: "RTU-1", values: { flow: 1 }, ts: 1_754_390_000_000 }),
    );
    assert(parsed.devId === "RTU-1", "dev_id becomes the device key");
    assert(parsed.values.flow === 1, "the nested `values` object is used when present");
    assert(
      parsed.at?.getTime() === 1_754_390_000_000,
      "a numeric `ts` becomes the device timestamp",
    );
  }

  {
    // index.js:115 — `body.values && typeof body.values === "object" ? body.values : body`.
    // A flat payload is read as the value bag itself.
    const parsed = parsePayload(JSON.stringify({ dev_id: "RTU-1", flow: 2 }));
    assert(parsed.values.flow === 2, "a flat payload is its own value bag");
  }

  {
    // **The one deliberate change from index.js.** Legacy defaults a missing
    // `ts` to `Date.now()`; the contract says set `at` only where the protocol
    // genuinely carries a timestamp, and let the host substitute receive time.
    const parsed = parsePayload(JSON.stringify({ dev_id: "RTU-1", values: { flow: 1 } }));
    assert(parsed.at === undefined, "a missing `ts` must leave `at` unset, not fabricate one");
  }

  {
    const parsed = parsePayload(JSON.stringify({ dev_id: "RTU-1", values: {}, ts: "nonsense" }));
    assert(parsed.at === undefined, "a non-numeric `ts` must not become an Invalid Date");
  }

  {
    // `null` values is not an object bag — index.js's `body.values &&` guard.
    const parsed = parsePayload(JSON.stringify({ dev_id: "RTU-1", values: null, flow: 5 }));
    assert(parsed.values.flow === 5, "a null `values` falls back to the body");
  }

  {
    // The real Bhutnirghat I envelope, transcribed from
    // `exports/PHE-MQTT-REFERENCE.md`: `rssi` sits *beside* `values`, not in it.
    // index.js takes `body.values` instead of the body whenever it is an
    // object, so `rssi` was unreachable and `network_strength` silently never
    // arrived — confirmed against the live feed on 2026-08-06, 20 of 22 mapped
    // points landing. This is the assertion that fix exists for.
    const parsed = parsePayload(
      JSON.stringify({
        dev_id: "861736076104923",
        ts: "1782472726000",
        rssi: "29",
        values: { di1: "1", batt_volt: "100.00", s09_r01: "10.81" },
      }),
    );
    assert(parsed.values.rssi === "29", "a reading published beside `values` is reachable");
    assert(parsed.values.s09_r01 === "10.81", "nested readings still arrive");
    const samples = samplesFromPayload(parsed, ["rssi", "s09_r01"]);
    assert(samples.length === 2, "both layers reach samplesFromPayload");
    assert(
      samples.find((s) => s.sourceKey === "rssi")?.value === 29,
      "`rssi` becomes a sample, which is the whole point of the merge",
    );
  }

  {
    // Envelope, not telemetry. Both coerce to finite numbers, so without the
    // exclusion they would land as readings the moment anything mapped them —
    // and `device_timestamp` (which the PHE seed *does* map to `ts`) would be a
    // point whose value is its own row's `time` in epoch milliseconds.
    const parsed = parsePayload(
      JSON.stringify({ dev_id: "861736076104923", ts: 1_782_472_726_000, values: { flow: 1 } }),
    );
    assert(parsed.values.ts === undefined, "`ts` is the sample time, never a reading");
    assert(parsed.values.dev_id === undefined, "`dev_id` routes the sample, never a reading");
    assert(
      samplesFromPayload(parsed, ["ts", "dev_id"]).length === 0,
      "no envelope field can be mapped into telemetry",
    );
    // The exclusion must not cost the timestamp itself.
    assert(parsed.at?.getTime() === 1_782_472_726_000, "`ts` still sets `at`");
  }

  {
    // Collision: the nested block is the more specific source and wins. Stated
    // as a test because the merge order is otherwise invisible, and reversing
    // it would silently prefer a stale outer copy.
    const parsed = parsePayload(
      JSON.stringify({ dev_id: "RTU-1", flow: 99, values: { flow: 1 } }),
    );
    assert(parsed.values.flow === 1, "the nested `values` block wins a key collision");
  }

  // ---- value guards, verbatim from index.js -------------------------------

  {
    const samples = samplesFromPayload(
      {
        devId: "RTU-1",
        values: { flow: 1.5, empty: "", nul: null, undef: undefined, text: "abc", zero: 0, numeric: "7.25" },
      },
      ["flow", "empty", "nul", "undef", "text", "zero", "numeric", "absent"],
    );
    const byKey = new Map(samples.map((s) => [s.sourceKey, s.value]));
    assert(byKey.get("flow") === 1.5, "a numeric value is emitted");
    // index.js:140 — "" is an absent reading, not a zero. That distinction is
    // the difference between a gap and a false alarm.
    assert(!byKey.has("empty"), "an empty string is an absent reading, not 0");
    assert(!byKey.has("nul"), "null is an absent reading");
    assert(!byKey.has("undef"), "undefined is an absent reading");
    assert(!byKey.has("text"), "a non-numeric string is not a reading");
    assert(!byKey.has("absent"), "a mapped key missing from the payload yields nothing");
    assert(byKey.get("zero") === 0, "0 is a real reading and must survive");
    assert(byKey.get("numeric") === 7.25, "a numeric string is coerced, as index.js does");
  }

  {
    // Scoped to the binding's sourceKeys: the row count matches index.js, which
    // iterates the mapping rather than the payload.
    const samples = samplesFromPayload(
      { devId: "RTU-1", values: { flow: 1, unmapped: 2 } },
      ["flow"],
    );
    assert(samples.length === 1, "only mapped source keys are emitted");
    assert(samples[0].deviceKey === "RTU-1", "every sample carries its device key");
  }

  // ---- an oversized payload is never parsed -------------------------------

  {
    const broker = makeFakeBroker();
    const adapter = createMqttAdapter(broker.transport);
    const controller = new AbortController();
    const warnings: { message: string; fields?: Record<string, unknown> }[] = [];
    const connecting = adapter.connect({
      protocol: "mqtt",
      endpointKey: "e",
      config: { host: "h", port: 8883, rejectUnauthorized: true },
      credentials: {},
      bindings: [
        { rtuId: "1", rtuCode: "R", deviceKey: "R", device: { topic: "t" }, sourceKeys: ["flow"] },
      ],
      logger: {
        info: () => undefined,
        warn: (message, fields) => warnings.push({ message, ...(fields === undefined ? {} : { fields }) }),
        error: () => undefined,
      },
      signal: controller.signal,
    });
    broker.fireConnect();
    await connecting;

    const received: unknown[] = [];
    await adapter.subscribe((samples) => received.push(...samples));

    // ADR 0016 §5 rule 6 — "no unbounded synchronous parse of an arbitrarily
    // large payload". `JSON.parse` is synchronous and the host multiplexes every
    // endpoint into one process, so a multi-megabyte frame would stall every
    // other supervisor's drain loop too.
    const huge = `{"dev_id":"R","values":{"flow":1},"pad":"${"x".repeat(MAX_PAYLOAD_BYTES)}"}`;
    broker.fireMessage("t", huge);
    assert(received.length === 0, "an oversized payload must not produce samples");
    assert(warnings.length === 1, "an oversized payload must be reported, not silently dropped");
    assert(
      typeof warnings[0].fields?.bytes === "number",
      "the size is logged so the limit can be tuned from evidence",
    );
    assert(
      !JSON.stringify(warnings[0]).includes("xxxxxxxx"),
      "the payload content must never be logged (AGENTS.md §9.6)",
    );

    // A normal frame still flows.
    broker.fireMessage("t", JSON.stringify({ dev_id: "R", values: { flow: 9 } }));
    assert(received.length === 1, "an ordinary payload is unaffected");
  }

  // ---- wildcard device topics are rejected by the schema ------------------

  {
    for (const topic of ["#", "+", "a/b/#", "a/+/c"]) {
      assert(
        !mqttDeviceSchema.safeParse({ topic }).success,
        `"${topic}" is a wildcard subscription, not one device's topic`,
      );
    }
    assert(
      mqttDeviceSchema.safeParse({ topic: "Airsprint-1051/Data/1051" }).success,
      "an ordinary topic still parses",
    );
  }

  // ---- the host owns reconnect --------------------------------------------

  {
    const broker = makeFakeBroker();
    const adapter = createMqttAdapter(broker.transport);
    const controller = new AbortController();
    const connecting = adapter.connect({
      protocol: "mqtt",
      endpointKey: "phe.thinkiot.co.in:8883",
      config: { host: "phe.thinkiot.co.in", port: 8883, rejectUnauthorized: true },
      credentials: { username: "u", password: "p" },
      bindings: [
        {
          rtuId: "id-1",
          rtuCode: "RTU-1",
          deviceKey: "RTU-1",
          device: { topic: "a/b/1" },
          sourceKeys: ["flow"],
        },
        {
          rtuId: "id-2",
          rtuCode: "RTU-2",
          deviceKey: "RTU-2",
          device: { topic: "a/b/1" },
          sourceKeys: ["flow"],
        },
      ],
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      signal: controller.signal,
    });
    broker.fireConnect();
    await connecting;

    const call = broker.connectCalls[0];
    assert(call.url === "mqtts://phe.thinkiot.co.in:8883", `wrong broker URL: ${call.url}`);
    // ADR 0016 §5 gives reconnect backoff to the host — exponential, base 1 s,
    // cap 60 s, ±20% jitter — and rule 4 says an adapter owns no timer.
    // index.js sets `reconnectPeriod: MQTT_RECONNECT_MS ?? 5000`; leaving that
    // on would race the supervisor and hide disconnections from it.
    assert(
      call.options.reconnectPeriod === 0,
      `the library's own reconnect must be off, got ${call.options.reconnectPeriod}`,
    );
    assert(call.options.rejectUnauthorized === true, "TLS verification is passed through");
    assert(
      call.options.username === "u" && call.options.password === "p",
      "credentials arrive from context, never from process.env",
    );

    await adapter.subscribe(() => undefined);
    // Two bindings on one topic must produce one subscription — index.js
    // de-duplicates with a Set for the same reason.
    assert(
      broker.subscriptions.length === 1,
      `a shared topic must be subscribed once, got ${broker.subscriptions.length}`,
    );

    await adapter.disconnect();
    assert(broker.ended === 1, "disconnect() must close the transport");
    await adapter.disconnect();
    assert(broker.ended === 1, "a second disconnect() must be a no-op, not a second close");
  }

  // ---- an aborted connect rejects rather than hanging ---------------------

  {
    const broker = makeFakeBroker();
    const adapter = createMqttAdapter(broker.transport);
    const controller = new AbortController();
    const connecting = adapter.connect({
      protocol: "mqtt",
      endpointKey: "e",
      config: { host: "h", port: 8883, rejectUnauthorized: true },
      credentials: {},
      bindings: [
        { rtuId: "1", rtuCode: "R", deviceKey: "R", device: { topic: "t" }, sourceKeys: ["flow"] },
      ],
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      signal: controller.signal,
    });
    // The supervisor's 30 s connect timeout aborts the signal (§5). Without
    // this the promise would never settle and the supervisor could not back off.
    controller.abort();
    let rejected = false;
    try {
      await connecting;
    } catch {
      rejected = true;
    }
    assert(rejected, "an aborted connect() must reject so the supervisor can back off");
  }

  // ---- a malformed payload is one device misbehaving, not a fault ---------

  {
    const broker = makeFakeBroker();
    const adapter = createMqttAdapter(broker.transport);
    const controller = new AbortController();
    const warnings: string[] = [];
    const connecting = adapter.connect({
      protocol: "mqtt",
      endpointKey: "e",
      config: { host: "h", port: 8883, rejectUnauthorized: true },
      credentials: {},
      bindings: [
        { rtuId: "1", rtuCode: "R", deviceKey: "R", device: { topic: "t" }, sourceKeys: ["flow"] },
      ],
      logger: {
        info: () => undefined,
        warn: (message) => warnings.push(message),
        error: () => undefined,
      },
      signal: controller.signal,
    });
    broker.fireConnect();
    await connecting;

    const received: unknown[] = [];
    await adapter.subscribe((samples) => received.push(...samples));
    broker.fireMessage("t", "{not json");
    assert(received.length === 0, "a malformed payload yields no samples");
    // index.js returns silently here; rule 9 forbids swallowing without a reason.
    assert(warnings.length === 1, "a malformed payload must be logged, not swallowed");
    assert(
      !warnings[0].includes("{not json"),
      "the log must not echo the payload — it can carry PII (AGENTS.md §9.6)",
    );

    // The connection survives it.
    broker.fireMessage("t", JSON.stringify({ dev_id: "R", values: { flow: 9 } }));
    assert(received.length === 1, "the next good message must still be delivered");
  }
}
