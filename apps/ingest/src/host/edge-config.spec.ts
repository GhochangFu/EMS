import { readFileSync } from "node:fs";

import {
  EDGE_DEFAULT_BUFFER_MAX_AGE_MS,
  EDGE_DEFAULT_BUFFER_MAX_BYTES,
  EDGE_DEFAULT_REPLAY_MAX_SAMPLES_PER_S,
  EDGE_MAX_BUFFER_MAX_AGE_MS,
} from "@bms/shared/ingest";

import { lookupAdapter } from "../adapter/registry.js";
import { readMqttPlaintextHosts } from "./config.js";
import { DEFAULT_EDGE_BUFFER_DIR, parseEdgeConfigFile, readEdgeEnv, type EdgeEnv } from "./edge-config.js";
import { assert } from "./normaliser.spec.js";

/**
 * `E7.2` / ADR 0123 decisions 3, 5 and 7, plan T5.1 and C11 — the edge's
 * environment and configuration file. Assertions live here;
 * `edge-config.test.ts` is the vitest entry point (ADR 0014).
 *
 * Every refusal is also checked for what it must **not** say: a token, a URL
 * with credentials, a credential value or a config value never reaches an
 * error message (AGENTS.md §9.6), because `edge-main.ts` logs the message on
 * a refused start.
 */

/** A syntactically valid gateway token. Generated shape, not a real one. */
export const EDGE_TOKEN = `bmsgw_${"EdgeConfigSpecToken".padEnd(43, "x")}`;

const BASE: NodeJS.ProcessEnv = {
  EDGE_CONFIG_FILE: "/etc/bms-edge/edge-config.json",
  EDGE_UPLINK_URL: "https://ems.example.test",
  EDGE_GATEWAY_TOKEN: EDGE_TOKEN,
};

function thrownMessage(fn: () => unknown, what: string): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected ${what} to throw`);
}

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...BASE, ...overrides };
}

/** Every required variable is named when missing or blank. */
export function eachRequiredVariableIsNamed(): void {
  for (const name of ["EDGE_CONFIG_FILE", "EDGE_UPLINK_URL", "EDGE_GATEWAY_TOKEN"]) {
    for (const value of [undefined, "  "]) {
      const message = thrownMessage(() => readEdgeEnv(env({ [name]: value })), `${name}=${String(value)}`);
      assert(message.includes(name), `a missing ${name} must be named, got: ${message}`);
    }
  }
  // Positive control: the base environment starts.
  const parsed = readEdgeEnv(BASE);
  assert(parsed.uplinkUrl.href === "https://ems.example.test/", `uplink URL parsed: ${parsed.uplinkUrl.href}`);
  assert(parsed.gatewayToken === EDGE_TOKEN, "the token is carried through");
}

/** The edge has no plain-text uplink and no switch to one (decision 5). */
export function anHttpOrCredentialedUplinkUrlIsRefused(): void {
  const refused = [
    "http://ems.example.test",
    "http://127.0.0.1:9200",
    "https://user:s3cret-pass@ems.example.test",
    "https://ems.example.test/edge/v1/batches",
    "https://ems.example.test/?k=v",
    "https://ems.example.test/#frag",
    "ftp://ems.example.test",
    "not a url s3cret-pass",
  ];
  for (const url of refused) {
    const message = thrownMessage(() => readEdgeEnv(env({ EDGE_UPLINK_URL: url })), url);
    assert(message.includes("EDGE_UPLINK_URL"), `the variable must be named for ${url}: ${message}`);
    assert(!message.includes("s3cret-pass"), `the refusal must not echo the URL: ${message}`);
  }
  assert(readEdgeEnv(env({ EDGE_UPLINK_URL: "https://ems.example.test:8443/" })).uplinkUrl.port === "8443", "a port is fine");
}

/** A malformed token is refused without being printed. */
export function aMalformedTokenIsRefusedUnprinted(): void {
  for (const token of ["bmsgw_short", `${EDGE_TOKEN}x`, `Bearer ${EDGE_TOKEN}`, EDGE_TOKEN.replace("bmsgw_", "bmsgx_")]) {
    const message = thrownMessage(() => readEdgeEnv(env({ EDGE_GATEWAY_TOKEN: token })), "a bad token");
    assert(message.includes("EDGE_GATEWAY_TOKEN"), `the variable must be named: ${message}`);
    assert(!message.includes("EdgeConfigSpecToken") && !message.includes("bmsgw_short"), `token echoed: ${message}`);
  }
}

/** Defaults, and the 6 d ceiling on the age bound (decision 7). */
export function theBufferBoundsDefaultAndTheAgeHasACeiling(): void {
  const parsed: EdgeEnv = readEdgeEnv(BASE);
  assert(parsed.bufferDir === DEFAULT_EDGE_BUFFER_DIR, `default dir: ${parsed.bufferDir}`);
  assert(parsed.bufferMaxAgeMs === EDGE_DEFAULT_BUFFER_MAX_AGE_MS && parsed.bufferMaxAgeMs === 259_200_000, "72 h");
  assert(parsed.bufferMaxBytes === EDGE_DEFAULT_BUFFER_MAX_BYTES && parsed.bufferMaxBytes === 1_073_741_824, "1 GiB");
  const ceiling = readEdgeEnv(env({ EDGE_BUFFER_MAX_AGE_MS: String(EDGE_MAX_BUFFER_MAX_AGE_MS) }));
  assert(ceiling.bufferMaxAgeMs === 518_400_000, "exactly 6 d is accepted");
  const message = thrownMessage(
    () => readEdgeEnv(env({ EDGE_BUFFER_MAX_AGE_MS: String(EDGE_MAX_BUFFER_MAX_AGE_MS + 1) })),
    "6 d + 1 ms",
  );
  assert(message.includes("EDGE_BUFFER_MAX_AGE_MS"), `the age ceiling must be named: ${message}`);
  thrownMessage(() => readEdgeEnv(env({ EDGE_BUFFER_MAX_BYTES: "1e9" })), "a non-decimal byte cap");
}

/** A relative path would land on the container's writable layer. */
export function relativePathsAreRefused(): void {
  for (const name of ["EDGE_CONFIG_FILE", "EDGE_BUFFER_DIR"]) {
    const message = thrownMessage(() => readEdgeEnv(env({ [name]: "relative/dir" })), `relative ${name}`);
    assert(message.includes(name) && message.includes("absolute"), `${name}: ${message}`);
  }
  assert(readEdgeEnv(env({ EDGE_BUFFER_DIR: "/data/edge" })).bufferDir === "/data/edge", "an absolute dir is kept");
}

/** The replay throttle has a floor of 50/s (plan C3). */
export function theReplayRateHasAFloor(): void {
  assert(readEdgeEnv(BASE).replayMaxSamplesPerS === EDGE_DEFAULT_REPLAY_MAX_SAMPLES_PER_S, "default 500");
  assert(readEdgeEnv(env({ EDGE_REPLAY_MAX_SAMPLES_PER_S: "50" })).replayMaxSamplesPerS === 50, "50 is the floor");
  const message = thrownMessage(() => readEdgeEnv(env({ EDGE_REPLAY_MAX_SAMPLES_PER_S: "49" })), "49/s");
  assert(message.includes("EDGE_REPLAY_MAX_SAMPLES_PER_S"), `the rate must be named: ${message}`);
}

/** Node's own TLS switch is refused: the edge never lowers certificate verification. */
export function nodesTlsSwitchIsRefused(): void {
  const message = thrownMessage(() => readEdgeEnv(env({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })), "TLS off");
  assert(message.includes("NODE_TLS_REJECT_UNAUTHORIZED"), `named: ${message}`);
  readEdgeEnv(env({ NODE_TLS_REJECT_UNAUTHORIZED: "1" }));
}

/** The edge reads no database variable: a stray `DATABASE_URL` is not required and not kept. */
export function theEdgeNeedsNoDatabase(): void {
  const parsed = readEdgeEnv(BASE) as Record<string, unknown>;
  assert(!("databaseUrl" in parsed), "the edge config must have no database URL");
}

const MQTT_ENDPOINT = {
  protocol: "mqtt",
  config: { host: "broker.site.local", port: 8883 },
  credentials: { username: "EDGE_CRED_SITE_USER", password: "EDGE_CRED_SITE_PASS" },
  devices: [{ deviceKey: "RTU-1", device: { topic: "site/rtu-1" }, sourceKeys: ["kw", "kwh"] }],
};

const CRED_ENV: NodeJS.ProcessEnv = { EDGE_CRED_SITE_USER: "site-user", EDGE_CRED_SITE_PASS: "Pa55-VALUE-never-printed" };

function file(endpoints: readonly unknown[]): string {
  return JSON.stringify({ endpoints });
}

function parse(text: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const fullEnv = { ...CRED_ENV, ...extraEnv };
  return parseEdgeConfigFile(text, { env: fullEnv, lookup: lookupAdapter, mqttPlaintextHosts: readMqttPlaintextHosts(fullEnv) });
}

/** A good file resolves the adapter, validates through its schemas and resolves credentials. */
export function aGoodFileParses(): void {
  const [endpoint] = parse(file([MQTT_ENDPOINT]));
  assert(endpoint.protocol === "mqtt", "protocol");
  assert(endpoint.factory === lookupAdapter("mqtt"), "the registry's factory");
  const config = endpoint.config as { rejectUnauthorized?: unknown; tls?: unknown };
  assert(config.rejectUnauthorized === true && config.tls === true, "the adapter's schema defaults applied");
  assert(endpoint.credentials.password === "Pa55-VALUE-never-printed", "the credential is read from the environment");
  assert(endpoint.devices[0]?.deviceKey === "RTU-1" && endpoint.devices[0]?.sourceKeys.length === 2, "device");
}

/** An unknown protocol is named; an adapter schema failure names the path and never the value. */
export function aBadProtocolOrAdapterConfigIsReportedByPath(): void {
  const unknown = thrownMessage(() => parse(file([{ ...MQTT_ENDPOINT, protocol: "zigbee" }])), "unknown protocol");
  assert(unknown.includes("endpoints[0].protocol") && unknown.includes("zigbee"), `unknown protocol: ${unknown}`);
  const unwired = thrownMessage(() => parse(file([{ ...MQTT_ENDPOINT, protocol: "modbus_tcp" }])), "no adapter");
  assert(unwired.includes("modbus_tcp"), `a protocol with no adapter is named: ${unwired}`);

  const badPort = { ...MQTT_ENDPOINT, config: { host: "broker.site.local", port: "SECRET-PORT-VALUE" } };
  const message = thrownMessage(() => parse(file([badPort])), "a bad port");
  assert(message.includes("endpoints[0].config.port"), `the path must be named: ${message}`);
  assert(!message.includes("SECRET-PORT-VALUE"), `the value must not be printed: ${message}`);

  const badTopic = { ...MQTT_ENDPOINT, devices: [{ deviceKey: "RTU-1", device: { topic: "site/#" }, sourceKeys: ["kw"] }] };
  const topic = thrownMessage(() => parse(file([badTopic])), "a wildcard topic");
  assert(topic.includes("endpoints[0].devices[0].device.topic"), `device path: ${topic}`);
  assert(!topic.includes("site/#"), `the topic must not be printed: ${topic}`);

  const notJson = thrownMessage(() => parse("{ SECRET-JSON-VALUE"), "bad JSON");
  assert(notJson.includes("EDGE_CONFIG_FILE") && !notJson.includes("SECRET-JSON-VALUE"), `bad JSON: ${notJson}`);
  const typo = thrownMessage(() => parse(file([{ ...MQTT_ENDPOINT, sourceKey: ["kw"] }])), "an unknown key");
  assert(typo.includes("sourceKey"), `a misspelt key is refused by name: ${typo}`);
}

/** Certificate verification cannot be lowered from the file (decision 5). */
export function rejectUnauthorizedIsRefused(): void {
  for (const value of [false, true]) {
    const endpoint = { ...MQTT_ENDPOINT, config: { ...MQTT_ENDPOINT.config, rejectUnauthorized: value } };
    const message = thrownMessage(() => parse(file([endpoint])), `rejectUnauthorized: ${String(value)}`);
    assert(message.includes("rejectUnauthorized"), `refused by name: ${message}`);
  }
}

/** Credentials are variable names only (C11): a bad name is refused, a missing variable named, no value printed. */
export function credentialsAreNamesOnly(): void {
  const pasted = { ...MQTT_ENDPOINT, credentials: { password: "hunter2-PASTED-SECRET" } };
  const message = thrownMessage(() => parse(file([pasted])), "a pasted secret");
  assert(message.includes("endpoints[0].credentials.password"), `the key path is named: ${message}`);
  assert(!message.includes("hunter2-PASTED-SECRET"), `a pasted secret must not be printed: ${message}`);

  const pastedKey = { ...MQTT_ENDPOINT, credentials: { username: "EDGE_CRED_U", "hunter2 KEY-SECRET": "EDGE_CRED_P" } };
  const byPosition = thrownMessage(() => parse(file([pastedKey])), "a secret pasted as a key");
  assert(byPosition.includes("endpoints[0].credentials[1]"), `a bad key is named by position: ${byPosition}`);
  assert(!byPosition.includes("KEY-SECRET"), `a bad key is never printed: ${byPosition}`);

  const lower = { ...MQTT_ENDPOINT, credentials: { password: "EDGE_CRED_lower" } };
  thrownMessage(() => parse(file([lower])), "a lower-case name");

  const missing = thrownMessage(
    () => parseEdgeConfigFile(file([MQTT_ENDPOINT]), { env: { EDGE_CRED_SITE_USER: "u" }, lookup: lookupAdapter, mqttPlaintextHosts: new Set() }),
    "a missing variable",
  );
  assert(missing.includes("EDGE_CRED_SITE_PASS"), `the missing variable is named: ${missing}`);
  assert(!missing.includes("u\""), "no value is printed");
}

/** A device key is the RTU's fleet-wide `rtu_code`: listed twice is refused. */
export function aDeviceKeyListedTwiceIsRefused(): void {
  const twice = {
    ...MQTT_ENDPOINT,
    devices: [
      { deviceKey: "RTU-1", device: { topic: "site/a" }, sourceKeys: ["kw"] },
      { deviceKey: "RTU-1", device: { topic: "site/b" }, sourceKeys: ["kw"] },
    ],
  };
  const message = thrownMessage(() => parse(file([twice])), "a duplicate device key");
  assert(message.includes("RTU-1") && message.includes("twice"), `duplicate named: ${message}`);
  const acrossEndpoints = { ...MQTT_ENDPOINT, config: { host: "other.site.local", port: 8883 } };
  thrownMessage(() => parse(file([MQTT_ENDPOINT, acrossEndpoints])), "a device key across endpoints");
}

/** Plain MQTT only to a host on `MQTT_PLAINTEXT_HOSTS` (ADR 0114, plan P6 = a). */
export function plainMqttOnlyForAnAllowListedHost(): void {
  const plain = { ...MQTT_ENDPOINT, config: { host: "broker.site.local", port: 1883, tls: false } };
  const message = thrownMessage(() => parse(file([plain])), "plain MQTT, empty allow-list");
  assert(message.includes("MQTT_PLAINTEXT_HOSTS"), `the allow-list is named: ${message}`);
  thrownMessage(() => parse(file([plain]), { MQTT_PLAINTEXT_HOSTS: "other.site.local" }), "another host listed");
  const [allowed] = parse(file([plain]), { MQTT_PLAINTEXT_HOSTS: "broker.site.local" });
  assert((allowed.config as { tls?: unknown }).tls === false, "a listed host connects plain");
}

/**
 * The MQTT adapter emits only a device's listed `sourceKeys`, so an MQTT
 * device with none would report nothing for ever; refused at start. A payload
 * format is written inline on the device (C11); the endpoint-level catalog
 * code has no catalog to join on the box and is refused.
 */
export function mqttDevicesNeedSourceKeysAndInlineFormats(): void {
  const none = { ...MQTT_ENDPOINT, devices: [{ deviceKey: "RTU-1", device: { topic: "site/rtu-1" } }] };
  const message = thrownMessage(() => parse(file([none])), "no sourceKeys");
  assert(message.includes("endpoints[0].devices[0].sourceKeys"), `sourceKeys named: ${message}`);
  const catalog = { ...MQTT_ENDPOINT, config: { ...MQTT_ENDPOINT.config, payloadFormat: "acme-json" } };
  const code = thrownMessage(() => parse(file([catalog])), "a catalog code");
  assert(code.includes("endpoints[0].config.payloadFormat"), `payloadFormat named: ${code}`);
  const inline = {
    ...MQTT_ENDPOINT,
    devices: [
      {
        deviceKey: "RTU-1",
        device: {
          topic: "site/rtu-1",
          payloadFormat: {
            code: "acme-json",
            definition: { kind: "declarative", root: "object", readings: [{ key: "kw", field: ["kw"] }] },
          },
        },
        sourceKeys: ["kw"],
      },
    ],
  };
  const [endpoint] = parse(file([inline]));
  const device = endpoint.devices[0]?.device as { payloadFormat?: { code?: string } };
  assert(device.payloadFormat?.code === "acme-json", "an inline payload format reaches the adapter");
}

/** `deploy/edge/edge-config.example.json` is a file the box accepts, with its two credential names. */
export function theShippedExampleParses(): void {
  const text = readFileSync(new URL("../../../../deploy/edge/edge-config.example.json", import.meta.url), "utf8");
  const [endpoint] = parseEdgeConfigFile(text, {
    env: { EDGE_CRED_SITE_BROKER_USER: "u", EDGE_CRED_SITE_BROKER_PASSWORD: "p" },
    lookup: lookupAdapter,
    mqttPlaintextHosts: new Set(),
  });
  assert(endpoint?.protocol === "mqtt" && endpoint.devices.length === 1, "the example is one MQTT endpoint");
}
