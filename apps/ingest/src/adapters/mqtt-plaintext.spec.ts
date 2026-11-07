import type { MqttConfig } from "@bms/shared/ingest";

import { createMqttAdapter, mqttAdapterFactory } from "./mqtt.js";
import { makeFakeBroker } from "./mqtt.spec.js";

/**
 * `F4.326` / ADR 0114 decision 3 — the adapter's half of plain MQTT.
 *
 * The adapter does not decide whether plain is allowed (the host does, before an
 * endpoint exists); it only builds what the validated config says: `mqtt://`
 * for the literal `tls: false`, `mqtts://` otherwise, no `rejectUnauthorized` on
 * plain, one `mqtt endpoint is plaintext` warning per adapter instance with the
 * host and port only, and a scheme-prefixed endpoint key for plain alone (plan R1).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Captured = { message: string; fields: Record<string, unknown> };

const SECRET_USER = "plain-user-sentinel";
const SECRET_PASSWORD = "plain-password-sentinel";

async function connectOnce(config: MqttConfig, reconnects = 1) {
  const broker = makeFakeBroker();
  const adapter = createMqttAdapter(broker.transport);
  const warnings: Captured[] = [];
  for (let i = 0; i < reconnects; i += 1) {
    const connecting = adapter.connect({
      protocol: "mqtt",
      endpointKey: mqttAdapterFactory.endpointKey(config, "rtu-1"),
      config,
      credentials: { username: SECRET_USER, password: SECRET_PASSWORD },
      bindings: [
        { rtuId: "rtu-1", rtuCode: "RTU-1", deviceKey: "RTU-1", device: { topic: "t/1" }, sourceKeys: ["flow"] },
      ],
      logger: {
        info: () => undefined,
        warn: (message, fields) => warnings.push({ message, fields: fields ?? {} }),
        error: () => undefined,
      },
      signal: new AbortController().signal,
    });
    broker.fireConnect();
    await connecting;
    await adapter.disconnect();
  }
  return { broker, warnings };
}

const PLAIN: MqttConfig = { host: "plain.example", port: 1883, rejectUnauthorized: true, tls: false };
const TLS: MqttConfig = { host: "tls.example", port: 8883, rejectUnauthorized: true, tls: true };

/** A1 — the scheme follows `tls`, and plain passes no `rejectUnauthorized`. */
export async function runSchemePerTlsTests(): Promise<void> {
  const plain = await connectOnce(PLAIN);
  const plainCall = plain.broker.connectCalls[0];
  assert(plainCall.url === "mqtt://plain.example:1883", `plain URL: ${plainCall.url}`);
  assert(
    !Object.prototype.hasOwnProperty.call(plainCall.options, "rejectUnauthorized"),
    "a plain connection carries no rejectUnauthorized",
  );
  assert(plainCall.options.username === SECRET_USER, "credentials still reach the broker");

  const tls = await connectOnce(TLS);
  const tlsCall = tls.broker.connectCalls[0];
  assert(tlsCall.url === "mqtts://tls.example:8883", `TLS URL: ${tlsCall.url}`);
  assert(tlsCall.options.rejectUnauthorized === true, "TLS verification is passed through");
}

/** A2 — exactly one plaintext warning per adapter instance, host and port only; none on TLS. */
export async function runPlaintextWarningTests(): Promise<void> {
  const plain = await connectOnce(PLAIN, 2);
  const lines = plain.warnings.filter((w) => w.message === "mqtt endpoint is plaintext");
  assert(lines.length === 1, `one warning across two connects, got ${lines.length}`);
  assert(
    JSON.stringify(Object.keys(lines[0].fields).sort()) === JSON.stringify(["host", "port"]),
    `host and port only: ${JSON.stringify(lines[0].fields)}`,
  );
  assert(lines[0].fields.host === "plain.example" && lines[0].fields.port === 1883, "the endpoint");
  const text = JSON.stringify(plain.warnings);
  assert(
    !text.includes(SECRET_USER) && !text.includes(SECRET_PASSWORD),
    "no credential reaches a warning (§9.6)",
  );

  const tls = await connectOnce(TLS);
  assert(
    !tls.warnings.some((w) => w.message === "mqtt endpoint is plaintext"),
    "a TLS endpoint never logs the plaintext warning",
  );
}

/** A3 — the TLS key is unchanged; only a plain endpoint carries `mqtt://` (plan R1). */
export function runEndpointKeyPerSchemeTests(): void {
  assert(mqttAdapterFactory.endpointKey(TLS, "x") === "tls.example:8883", "TLS key unchanged");
  assert(
    mqttAdapterFactory.endpointKey(PLAIN, "x") === "mqtt://plain.example:1883",
    "plain key carries its scheme",
  );
  assert(
    mqttAdapterFactory.endpointKey({ ...PLAIN, tls: true }, "x") !==
      mqttAdapterFactory.endpointKey(PLAIN, "x"),
    "a TLS and a plain RTU on one host never share a connection",
  );
}
