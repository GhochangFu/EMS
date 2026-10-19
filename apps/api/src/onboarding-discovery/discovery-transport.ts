import { isIP } from "node:net";

import { MQTT_DISCOVERY_MAX_PAYLOAD_BYTES } from "@bms/shared";
import { connect } from "mqtt";

import type { DiscoveryCredentials } from "./discovery-credentials";
import { resolveBrokerHost, type HostResolution } from "./discovery-host-guard";

/**
 * `F3.24b` (ADR 0103 decisions 3 and 4, decisions Q5; security review M1) —
 * the one broker connection a discovery opens, and the seam a test reaches a
 * plain broker through.
 *
 * **Always `mqtts`, always `rejectUnauthorized: true`** (decisions Q5): the
 * same scheme ingest connects with (`apps/ingest/src/adapters/mqtt.ts`), and
 * the draft's `tls` flag selects nothing. **`host` is the checked address**
 * and there is no `hostname` — mqtt.js reads `hostname` before `host`, so a
 * typed name there would be looked up again (DNS rebinding). `servername`
 * carries the typed name for SNI and certificate checks, and only when the
 * typed host is a name: an IP as SNI is not valid (RFC 6066).
 *
 * **No `publish`.** The handle this port returns exposes `on`, `subscribe`
 * and `end` and nothing else, so the job cannot publish (decision 4).
 *
 * **The seam is constructor injection, never the environment.**
 * `DISCOVERY_TRANSPORT_OPTIONS` defaults to {@link PRODUCTION_TRANSPORT_OPTIONS};
 * the integration spec constructs the job with `protocol: "mqtt"` and a
 * resolver that answers the CI broker's address, so the production path
 * stays mqtts-only and guarded.
 */

export const DISCOVERY_TRANSPORT = Symbol("DISCOVERY_TRANSPORT");
export const DISCOVERY_TRANSPORT_OPTIONS = Symbol("DISCOVERY_TRANSPORT_OPTIONS");

/** How long the job waits for a CONNACK before it reports `timeout`. */
export const DISCOVERY_CONNECT_TIMEOUT_MS = 10_000;

export type DiscoveryConnectOptions = {
  readonly protocol: "mqtts" | "mqtt";
  readonly host: string;
  readonly port: number;
  readonly servername?: string;
  readonly clientId: string;
  readonly clean: true;
  readonly reconnectPeriod: 0;
  readonly connectTimeout: number;
  readonly rejectUnauthorized: true;
  readonly username?: string;
  readonly password?: string;
};

export type DiscoveryClientHandle = {
  on(event: "connect", listener: () => void): void;
  on(event: "message", listener: (topic: string, payload: Uint8Array) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: () => void): void;
  subscribe(
    filter: string,
    options: { qos: 0 },
    callback: (error: Error | null | undefined, granted?: readonly { qos: number }[]) => void,
  ): void;
  end(force: boolean): void;
};

export type MqttDiscoveryTransport = {
  connect(options: DiscoveryConnectOptions): DiscoveryClientHandle;
};

export type DiscoveryTransportOptions = {
  readonly protocol: "mqtts" | "mqtt";
  readonly resolve: (host: string) => Promise<HostResolution>;
};

export const PRODUCTION_TRANSPORT_OPTIONS: DiscoveryTransportOptions = {
  protocol: "mqtts",
  resolve: (host) => resolveBrokerHost(host),
};

/** The discovery's own client id — always unique, never the ingest one. */
export function discoveryClientId(discoveryId: string): string {
  return `bms-discovery-${discoveryId}`;
}

/**
 * The largest MQTT remaining length the discovery reads: the collector's
 * payload cap plus room for the topic (the collector skips a topic over 255
 * characters anyway), a packet id and MQTT 5 properties.
 */
export const DISCOVERY_MAX_REMAINING_LENGTH = MQTT_DISCOVERY_MAX_PAYLOAD_BYTES + 4 * 1024;

/**
 * `F3.24b` review — a byte-stream reader of MQTT fixed headers. It is fed
 * every chunk the socket delivers, before mqtt.js's parser, and answers
 * `true` once a packet declares a remaining length over `maxRemaining`.
 *
 * The 256 KiB payload cap in the collector runs only after mqtt-packet has
 * buffered the whole packet, and MQTT allows about 256 MB. The worker also
 * runs every other tenant's jobs, so the connection ends at the header
 * instead (MQTT 3.1.1 has no maximum-packet-size the client can announce).
 * A malformed length (a fifth continuation byte) also answers `true`.
 */
export function createPacketSizeGuard(maxRemaining: number): (chunk: Uint8Array) => boolean {
  // "type": the next byte is a packet's first; "length": reading the varint; "body": skipping `left` bytes.
  let state: "type" | "length" | "body" = "type";
  let length = 0;
  let multiplier = 1;
  let lengthBytes = 0;
  let left = 0;
  let tripped = false;
  return (chunk) => {
    if (tripped) {
      return true;
    }
    let i = 0;
    while (i < chunk.length) {
      if (state === "body") {
        const skip = Math.min(left, chunk.length - i);
        left -= skip;
        i += skip;
        if (left === 0) {
          state = "type";
        }
        continue;
      }
      const byte = chunk[i] as number;
      i += 1;
      if (state === "type") {
        state = "length";
        length = 0;
        multiplier = 1;
        lengthBytes = 0;
        continue;
      }
      length += (byte & 0x7f) * multiplier;
      multiplier *= 128;
      lengthBytes += 1;
      if (length > maxRemaining || (byte & 0x80 && lengthBytes >= 4)) {
        tripped = true;
        return true;
      }
      if ((byte & 0x80) === 0) {
        left = length;
        state = left === 0 ? "type" : "body";
      }
    }
    return false;
  };
}

/** `[2001:db8::10]` as `2001:db8::10`; any other host trimmed. */
function unbracket(host: string): string {
  const h = host.trim();
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

export function buildConnectOptions(
  input: {
    readonly address: string;
    readonly typedHost: string;
    readonly port: number;
    readonly discoveryId: string;
    readonly credentials: DiscoveryCredentials;
  },
  transport: Pick<DiscoveryTransportOptions, "protocol">,
): DiscoveryConnectOptions {
  return {
    protocol: transport.protocol,
    host: input.address,
    port: input.port,
    // A bracketed IPv6 literal is an IP too: no SNI, and the certificate is checked against its IP SAN.
    ...(isIP(unbracket(input.typedHost)) === 0 ? { servername: input.typedHost } : {}),
    clientId: discoveryClientId(input.discoveryId),
    clean: true,
    reconnectPeriod: 0,
    // The job's own timer reports `timeout` first; this bound only stops the
    // library from waiting longer than the job does.
    connectTimeout: DISCOVERY_CONNECT_TIMEOUT_MS + 5_000,
    rejectUnauthorized: true,
    ...(input.credentials.username === undefined ? {} : { username: input.credentials.username }),
    ...(input.credentials.password === undefined ? {} : { password: input.credentials.password }),
  };
}

/** The production transport: mqtt.js behind a handle with no `publish`. */
export const mqttDiscoveryTransport: MqttDiscoveryTransport = {
  connect(options) {
    const client = connect({ ...options });
    // mqtt.js builds its stream and pipes it to the parser synchronously in
    // `connect`; a listener prepended here sees each chunk before the parser
    // buffers it, and ends the socket at an oversize header (F3.24b review).
    const over = createPacketSizeGuard(DISCOVERY_MAX_REMAINING_LENGTH);
    const stream = client.stream as unknown as NodeJS.ReadableStream & { destroy(): void };
    stream.prependListener("data", (chunk: Uint8Array) => {
      if (over(chunk)) {
        stream.destroy();
      }
    });
    const handle: DiscoveryClientHandle = {
      on(event: "connect" | "message" | "error" | "close", listener: (...args: never[]) => void) {
        client.on(event as "connect", listener as () => void);
      },
      subscribe(filter, opts, callback) {
        client.subscribe(filter, opts, (error, granted) => {
          callback(error, granted?.map((g) => ({ qos: g.qos })));
        });
      },
      end(force) {
        client.end(force);
      },
    };
    return handle;
  },
};
