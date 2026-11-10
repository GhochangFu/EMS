import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  EDGE_DEFAULT_BUFFER_MAX_AGE_MS,
  EDGE_DEFAULT_BUFFER_MAX_BYTES,
  EDGE_DEFAULT_REPLAY_MAX_SAMPLES_PER_S,
  EDGE_MAX_BUFFER_MAX_AGE_MS,
  EDGE_MIN_REPLAY_MAX_SAMPLES_PER_S,
  edgeConfigFileSchema,
  INGEST_PROTOCOLS,
  type IngestProtocol,
  MQTT_PLAINTEXT_HOSTS_ENV,
  mqttPlaintextDecision,
  UPLINK_TOKEN_PATTERN,
} from "@bms/shared/ingest";
import type { ZodIssue } from "zod";

import type { IngestAdapterFactory } from "../adapter/types.js";
// `config.ts` stays the one reader of the plain-MQTT allow-list in apps/ingest (plan M16).
import { DEFAULT_HEALTH_PORT, DEFAULT_STALE_AFTER_MS, positiveInt, readMqttPlaintextHosts } from "./config.js";

/**
 * The edge gateway's configuration (`E7.2`, ADR 0123 decisions 3, 5 and 7,
 * plan T5.1 and C11): the environment, and the endpoint file it names.
 *
 * The edge's counterpart of `config.ts`, and like it **the one place the edge
 * reads `process.env`** — `edge-main.ts` hands the environment in. The cloud's
 * `readHostConfig` is not reused because it requires `DATABASE_URL`, and the
 * edge must start with no database at all (decision 1).
 *
 * **Nothing secret reaches a message** (AGENTS.md §9.6). `edge-main.ts` logs
 * the message of a refused start, so a refusal names the variable or the file
 * path (`endpoints[0].config.port`) and never the value: not the token, not a
 * URL that may carry credentials, not a credential, not a config value.
 */

/** Where the edge keeps its buffer and clock mark unless `EDGE_BUFFER_DIR` says otherwise. */
export const DEFAULT_EDGE_BUFFER_DIR = "/var/lib/bms-edge";
/** `EDGE_BUFFER_MAX_BYTES` ceiling — a typo guard, as the cloud's 1 TiB is. */
const MAX_EDGE_BUFFER_BYTES = 2 ** 40;
/** `EDGE_REPLAY_MAX_SAMPLES_PER_S` ceiling. */
const MAX_REPLAY_SAMPLES_PER_S = 100_000;
/** The largest delay `setInterval` honours (see `config.ts`). */
const MAX_TIMER_MS = 2 ** 31 - 1;

export type EdgeEnv = {
  /** `EDGE_CONFIG_FILE`, absolute. */
  readonly configFile: string;
  /** `EDGE_UPLINK_URL`: an `https:` origin, no credentials, no path, query or fragment. */
  readonly uplinkUrl: URL;
  /** `EDGE_GATEWAY_TOKEN`. Never log, never echo, never persist (§9.6). */
  readonly gatewayToken: string;
  /** `EDGE_BUFFER_DIR`, absolute. Segments live under `<dir>/segments`, the clock mark beside them (C10). */
  readonly bufferDir: string;
  readonly bufferMaxAgeMs: number;
  readonly bufferMaxBytes: number;
  /** The backlog throttle (decision 9, plan C3). */
  readonly replayMaxSamplesPerS: number;
  /** The health listener, as on the cloud (`INGEST_HOST_HEALTH_PORT`, plan C12). */
  readonly healthPort: number;
  readonly staleAfterMs: number;
  /** ADR 0114's allow-list, read through `config.ts` (plan M16, P6 = a). */
  readonly mqttPlaintextHosts: ReadonlySet<string>;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return raw.trim();
}

function absolutePath(name: string, value: string): string {
  if (!isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return value;
}

/**
 * `EDGE_UPLINK_URL`, held to an `https:` origin.
 *
 * There is **no exception**, not even loopback: the edge has no switch to a
 * plain-text uplink (decision 5), so tests inject `fetch` rather than an
 * `http:` URL. Credentials in the URL are refused (the token is the only
 * credential, and it travels in a header), and so is a path: the client
 * appends `/edge/v1/batches` itself. The message is fixed — `new URL`'s own
 * error carries the input.
 */
function readUplinkUrl(raw: string): URL {
  const refuse = (): never => {
    throw new Error(
      "EDGE_UPLINK_URL must be an https:// origin with no credentials, path, query or fragment",
    );
  };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse();
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return refuse();
  }
  return url;
}

function readToken(raw: string): string {
  if (!UPLINK_TOKEN_PATTERN.test(raw)) {
    // Fixed text: a near-miss token is still most of a secret.
    throw new Error("EDGE_GATEWAY_TOKEN is not a gateway token (bmsgw_ followed by 43 characters)");
  }
  return raw;
}

/** Pure over its input, so every rule is testable without mutating `process.env`. */
export function readEdgeEnv(env: NodeJS.ProcessEnv): EdgeEnv {
  const configFile = absolutePath("EDGE_CONFIG_FILE", required(env, "EDGE_CONFIG_FILE"));
  const uplinkUrl = readUplinkUrl(required(env, "EDGE_UPLINK_URL"));
  const gatewayToken = readToken(required(env, "EDGE_GATEWAY_TOKEN"));
  const dirRaw = env.EDGE_BUFFER_DIR?.trim() ?? "";
  const bufferDir = dirRaw === "" ? DEFAULT_EDGE_BUFFER_DIR : absolutePath("EDGE_BUFFER_DIR", dirRaw);
  const replayMaxSamplesPerS = positiveInt(
    env.EDGE_REPLAY_MAX_SAMPLES_PER_S,
    EDGE_DEFAULT_REPLAY_MAX_SAMPLES_PER_S,
    "EDGE_REPLAY_MAX_SAMPLES_PER_S",
    MAX_REPLAY_SAMPLES_PER_S,
  );
  if (replayMaxSamplesPerS < EDGE_MIN_REPLAY_MAX_SAMPLES_PER_S) {
    throw new Error(
      `EDGE_REPLAY_MAX_SAMPLES_PER_S must be between ${EDGE_MIN_REPLAY_MAX_SAMPLES_PER_S} and ` +
        `${MAX_REPLAY_SAMPLES_PER_S}, got "${replayMaxSamplesPerS}"`,
    );
  }
  return {
    configFile,
    uplinkUrl,
    gatewayToken,
    bufferDir,
    // The 6 d ceiling keeps a backlog out of compressed chunks (ADR 0123 F3).
    bufferMaxAgeMs: positiveInt(
      env.EDGE_BUFFER_MAX_AGE_MS,
      EDGE_DEFAULT_BUFFER_MAX_AGE_MS,
      "EDGE_BUFFER_MAX_AGE_MS",
      EDGE_MAX_BUFFER_MAX_AGE_MS,
    ),
    bufferMaxBytes: positiveInt(
      env.EDGE_BUFFER_MAX_BYTES,
      EDGE_DEFAULT_BUFFER_MAX_BYTES,
      "EDGE_BUFFER_MAX_BYTES",
      MAX_EDGE_BUFFER_BYTES,
    ),
    replayMaxSamplesPerS,
    healthPort: positiveInt(env.INGEST_HOST_HEALTH_PORT, DEFAULT_HEALTH_PORT, "INGEST_HOST_HEALTH_PORT", 65535),
    staleAfterMs: positiveInt(env.INGEST_STALE_AFTER_MS, DEFAULT_STALE_AFTER_MS, "INGEST_STALE_AFTER_MS", MAX_TIMER_MS),
    mqttPlaintextHosts: readMqttPlaintextHosts(env),
  };
}

/** One device, validated by the adapter. */
export type EdgeDevice = {
  readonly deviceKey: string;
  readonly device: unknown;
  readonly sourceKeys: readonly string[];
};

/** One endpoint of the file, validated by its adapter, credentials resolved. */
export type EdgeEndpoint = {
  readonly protocol: IngestProtocol;
  readonly factory: IngestAdapterFactory;
  readonly config: unknown;
  /** Plaintext, from the box's environment. Never log, never echo, never persist. */
  readonly credentials: Readonly<Record<string, string>>;
  readonly devices: readonly EdgeDevice[];
};

export type EdgeFileDeps = {
  /** The environment the `EDGE_CRED_<NAME>` values are read from. */
  readonly env: NodeJS.ProcessEnv;
  readonly lookup: (protocol: IngestProtocol) => IngestAdapterFactory | undefined;
  readonly mqttPlaintextHosts: ReadonlySet<string>;
};

/** `endpoints[0].devices[1].device.topic` — a location in the file, never what is there. */
function where(prefix: string, path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (out, part) => (typeof part === "number" ? `${out}[${part}]` : out === "" ? part : `${out}.${part}`),
    prefix,
  );
}

/**
 * One zod issue as `path: code`. `issue.message` is not used: zod's built-in
 * messages quote the received value for enums and literals. A key name an
 * unknown-key issue lists is the operator's own, and is named.
 */
function describeIssue(prefix: string, issue: ZodIssue): string {
  const detail =
    issue.code === "unrecognized_keys"
      ? ` (${issue.keys.join(", ")})`
      : issue.code === "invalid_type"
        ? ` (expected ${issue.expected})`
        : "";
  return `${where(prefix, issue.path)}: ${issue.code}${detail}`;
}

/** Every problem in the file, not the first: a box on a site visit should be fixed in one pass. */
export class EdgeConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`EDGE_CONFIG_FILE refused: ${problems.join("; ")}`);
    this.name = "EdgeConfigError";
  }
}

function isProtocol(value: string): value is IngestProtocol {
  return (INGEST_PROTOCOLS as readonly string[]).includes(value);
}

/**
 * Parses and validates the file's text. Throws `EdgeConfigError` naming every
 * problem by its path in the file.
 *
 * The file's shape is `edgeConfigFileSchema`; each endpoint's `config` and
 * each device's `device` are then the adapter's own `configSchema` and
 * `deviceSchema`. On top of that, rules the cloud host applies to a database
 * row apply here to the file:
 *
 * - `rejectUnauthorized` is refused whatever its value — the cloud's
 *   `tls-downgrade-refused` (ADR 0123 decision 5: no switch to lower
 *   certificate verification);
 * - plain MQTT only to a host on `MQTT_PLAINTEXT_HOSTS` (ADR 0114, plan P6);
 * - a `deviceKey` is a fleet-wide `rtu_code`, so it may appear once;
 * - an MQTT endpoint may not name a catalog `payloadFormat` — there is no
 *   catalog on the box; a format is written inline on the device (C11);
 * - an MQTT device must list its `sourceKeys`: the adapter emits only listed
 *   keys, so a device with none would report nothing, silently, for ever.
 */
export function parseEdgeConfigFile(text: string, deps: EdgeFileDeps): readonly EdgeEndpoint[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new EdgeConfigError(["the file is not valid JSON"]);
  }
  const shape = edgeConfigFileSchema.safeParse(json);
  if (!shape.success) {
    throw new EdgeConfigError(shape.error.issues.map((issue) => describeIssue("", issue)));
  }

  const problems: string[] = [];
  const endpoints: EdgeEndpoint[] = [];
  const seenDeviceKeys = new Set<string>();

  shape.data.endpoints.forEach((entry, e) => {
    const at = `endpoints[${e}]`;
    const factory = isProtocol(entry.protocol) ? deps.lookup(entry.protocol) : undefined;
    if (factory === undefined || !isProtocol(entry.protocol)) {
      problems.push(`${at}.protocol: no adapter for protocol ${JSON.stringify(entry.protocol)}`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(entry.config, "rejectUnauthorized")) {
      problems.push(`${at}.config.rejectUnauthorized: refused; certificate verification cannot be changed at the edge`);
    }
    const config = factory.configSchema.safeParse(entry.config);
    if (!config.success) {
      problems.push(...config.error.issues.map((issue) => describeIssue(`${at}.config`, issue)));
    }

    if (entry.protocol === "mqtt") {
      const raw = entry.config as { tls?: unknown; host?: unknown; payloadFormat?: unknown };
      const host = typeof raw.host === "string" ? raw.host : undefined;
      if (mqttPlaintextDecision(raw.tls, host, deps.mqttPlaintextHosts) === "refused") {
        problems.push(`${at}.config.tls: plain MQTT is allowed only to a host listed in ${MQTT_PLAINTEXT_HOSTS_ENV}`);
      }
      if (raw.payloadFormat !== undefined) {
        problems.push(`${at}.config.payloadFormat: refused; write the payload format inline on each device`);
      }
    }

    const credentials: Record<string, string> = {};
    for (const [key, variable] of Object.entries(entry.credentials ?? {})) {
      const value = deps.env[variable];
      if (value === undefined || value === "") {
        problems.push(`${at}.credentials.${key}: environment variable ${variable} is not set`);
      } else {
        credentials[key] = value;
      }
    }

    const devices: EdgeDevice[] = [];
    entry.devices.forEach((deviceEntry, d) => {
      const deviceAt = `${at}.devices[${d}]`;
      if (seenDeviceKeys.has(deviceEntry.deviceKey)) {
        problems.push(`${deviceAt}.deviceKey: ${JSON.stringify(deviceEntry.deviceKey)} is listed twice`);
      }
      seenDeviceKeys.add(deviceEntry.deviceKey);
      const device = factory.deviceSchema.safeParse(deviceEntry.device);
      if (!device.success) {
        problems.push(...device.error.issues.map((issue) => describeIssue(`${deviceAt}.device`, issue)));
        return;
      }
      const sourceKeys = [...new Set(deviceEntry.sourceKeys ?? [])];
      if (entry.protocol === "mqtt" && sourceKeys.length === 0) {
        problems.push(`${deviceAt}.sourceKeys: required for MQTT; the adapter reports only the listed keys`);
      }
      devices.push({ deviceKey: deviceEntry.deviceKey, device: device.data, sourceKeys });
    });

    if (config.success) {
      endpoints.push({ protocol: entry.protocol, factory, config: config.data, credentials, devices });
    }
  });

  if (problems.length > 0) {
    throw new EdgeConfigError(problems);
  }
  return endpoints;
}

/** Reads `EDGE_CONFIG_FILE` and parses it. A file that cannot be read names the variable, not the error text. */
export async function loadEdgeConfigFile(path: string, deps: EdgeFileDeps): Promise<readonly EdgeEndpoint[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new Error(`EDGE_CONFIG_FILE could not be read (${typeof code === "string" ? code : "error"})`);
  }
  return parseEdgeConfigFile(text, deps);
}
