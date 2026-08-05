import type { ZodType } from "zod";

import type {
  AdapterHealth,
  AdapterMode,
  DiscoveredPoint,
  IngestProtocol,
  SourceSample,
} from "@bms/shared/ingest";

/**
 * The adapter interface (ADR 0016 §1, backlog `F1.1`).
 *
 * **Transcribed from the ADR rather than paraphrased.** This file is the thing
 * `F1.2`–`F1.6` build against in parallel; if it drifts from the ADR, five
 * agents implement five different contracts and the enabler has failed at the
 * one job it exists to do.
 *
 * Deliberately not in `@bms/shared`: nothing outside `apps/ingest` implements
 * or invokes these, and exporting them would widen the shared surface for no
 * consumer (ADR 0016 §8). The data contracts an adapter *emits* live in
 * `@bms/shared/ingest`, because `F3.24` and the `/admin/*` RTU screens consume
 * them.
 *
 * **The clause that makes six adapters safe to build in parallel:** an
 * adapter's total output is `SourceSample[]`. It never opens a Postgres
 * connection, never resolves an asset or point key, never owns a timer or a
 * process handler, and never reads `process.env`. The host owns all of it —
 * ADR 0016 §2 and §5, which are contract terms and not guidelines.
 */

/** Minimal logger the host binds to `{ rtuCode, protocol }`. Adapters must use only this. */
export type AdapterLogger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

/** One device served by an adapter instance. */
export type RtuBinding<TDevice> = {
  readonly rtuId: string;
  readonly rtuCode: string;
  /** How the device identifies itself on the wire; matches `SourceSample.deviceKey`. */
  readonly deviceKey: string;
  /** Validated per-device config (MQTT topic, Modbus unit id, OPC-UA node prefix). */
  readonly device: TDevice;
  /** `source_data_key`s this RTU is mapped for; adapters may use it to scope a read set. */
  readonly sourceKeys: readonly string[];
};

/** Everything an adapter is given. It must not reach outside this object for state. */
export type AdapterContext<TConfig, TDevice> = {
  readonly protocol: IngestProtocol;
  /** Identity of the endpoint this instance serves — the host's grouping key. */
  readonly endpointKey: string;
  /** Validated connection-level config. Non-secret by definition. */
  readonly config: TConfig;
  /** Plaintext endpoint secrets, decrypted by the host. Never log, never echo, never persist. */
  readonly credentials: Readonly<Record<string, string>>;
  /** Devices on this endpoint. Exactly one for connection-per-device protocols. */
  readonly bindings: readonly RtuBinding<TDevice>[];
  readonly logger: AdapterLogger;
  /** Aborted on shutdown or supervisor restart. Long operations must honour it. */
  readonly signal: AbortSignal;
};

/** Lifecycle every adapter shares, regardless of mode. */
type IngestAdapterBase<TConfig, TDevice> = {
  /** Establishes the transport. Must reject rather than throw synchronously. */
  connect(context: AdapterContext<TConfig, TDevice>): Promise<void>;
  /** Releases the transport. Must be idempotent and must not reject. */
  disconnect(): Promise<void>;
  /** Synchronous, cheap, never throws — callable before connect and after disconnect. */
  health(): AdapterHealth;
  /** Optional point discovery for F3.24 onboarding. Omit when the protocol cannot browse. */
  discover?(): Promise<readonly DiscoveredPoint[]>;
};

export type PushIngestAdapter<TConfig, TDevice> = IngestAdapterBase<TConfig, TDevice> & {
  readonly mode: "push";
  /** Attaches the sink. Resolves once the subscription is established. */
  subscribe(emit: (samples: readonly SourceSample[]) => void): Promise<void>;
};

export type PollIngestAdapter<TConfig, TDevice> = IngestAdapterBase<TConfig, TDevice> & {
  readonly mode: "poll";
  /** Cadence floor. The host may widen it under backoff; it never shortens it. */
  readonly defaultPollIntervalMs: number;
  /** One complete read cycle across every binding. The host guarantees no overlap. */
  poll(): Promise<readonly SourceSample[]>;
};

/**
 * A discriminated union, not a flat type with optional halves.
 *
 * ADR 0016's Options B3 rejects the flat shape explicitly: the discriminant is
 * a literal `mode` field so the host narrows at compile time and **a fan-out
 * agent cannot half-implement both halves**. A flat `{ mode, subscribe?, poll? }`
 * would let `{ mode: "push" }` with no `subscribe` compile, which is precisely
 * the class of error the toolchain in this PR exists to catch.
 */
export type IngestAdapter<TConfig = unknown, TDevice = unknown> =
  | PushIngestAdapter<TConfig, TDevice>
  | PollIngestAdapter<TConfig, TDevice>;

/** What an adapter module default-exports; the host builds one instance per endpoint. */
export type IngestAdapterFactory<TConfig = unknown, TDevice = unknown> = {
  readonly protocol: IngestProtocol;
  readonly mode: AdapterMode;
  /** Zod schema for the connection-level slice of `config` JSONB. Validated before `connect`. */
  readonly configSchema: ZodType<TConfig>;
  /** Zod schema for the per-device slice. Validated per binding before `connect`. */
  readonly deviceSchema: ZodType<TDevice>;
  /**
   * Grouping key. Return the connection identity (`host:port`) when one
   * connection serves many devices; return `rtuId` when each device needs its
   * own connection. This single function replaces a `scope` flag — the flag
   * would only ever be derivable from it.
   */
  endpointKey(config: TConfig, rtuId: string): string;
  /** Lets F3.24 filter for browsable protocols without constructing an instance. */
  readonly supportsDiscovery?: boolean;
  create(): IngestAdapter<TConfig, TDevice>;
};
