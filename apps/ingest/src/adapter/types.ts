import type {
  AdapterHealth,
  AdapterMode,
  DiscoveredPoint,
  IngestProtocol,
  SourceSample,
} from "@bms/shared/ingest";

/**
 * The adapter interface (ADR 0016, backlog `F1.1`).
 *
 * Deliberately **not** in `@bms/shared`: nothing outside `apps/ingest`
 * implements or calls these, and exporting them would widen the shared surface
 * for no consumer (ADR 0016 §8). The data contracts an adapter *emits* —
 * `SourceSample`, `AdapterHealth`, `IngestProtocol` — do live in
 * `@bms/shared/ingest`, because `F3.24`'s onboarding agent and the `/admin/*`
 * RTU screens consume them.
 *
 * **The one clause that makes six adapters safe to build in parallel:** an
 * adapter's total output is `SourceSample[]`. It never opens a Postgres
 * connection, never resolves an asset or a point key, never writes to
 * `telemetry.*`, and never owns a timer or a process handler. The host owns all
 * of it. See ADR 0016 §2 and §5 for the full prohibition list — it is a
 * contract term, not a guideline.
 */

/** Structured logging, the only channel an adapter may log through. */
export type AdapterLogger = {
  readonly debug: (message: string, fields?: Record<string, unknown>) => void;
  readonly info: (message: string, fields?: Record<string, unknown>) => void;
  readonly warn: (message: string, fields?: Record<string, unknown>) => void;
  readonly error: (message: string, fields?: Record<string, unknown>) => void;
};

/**
 * One RTU served by an adapter instance.
 *
 * `deviceKey` is `rtus.rtu_code` — the identifier the device names itself by,
 * and already what the PHE payload's `dev_id` is matched against. No new
 * column, no new concept (ADR 0016 §3).
 *
 * `device` is the per-device slice of `rtu_connection_configs.config`, already
 * validated against the adapter's own `deviceSchema` by the host.
 */
export type RtuBinding = {
  readonly rtuId: string;
  readonly deviceKey: string;
  readonly device: Record<string, unknown>;
};

/**
 * Everything an adapter is given. **The only input it may read** — an adapter
 * never touches `process.env`, for credentials or for anything else (ADR 0016
 * §4). New adapters get no environment fallback at all.
 */
export type AdapterContext = {
  /** Connection-level config, already validated against the adapter's `configSchema`. */
  readonly config: Record<string, unknown>;
  /**
   * Decrypted credentials, or `undefined` when the endpoint needs none.
   *
   * Already plaintext: the host decrypts through the existing, unmodified
   * `decryptCredentials()` so an adapter never sees ciphertext, an IV, a key
   * version, or `CREDENTIAL_ENCRYPTION_KEY`. **Must not** appear in
   * `health().detail`, in any `logger` call, or in a thrown message
   * (AGENTS.md §9.6).
   */
  readonly credentials?: Record<string, unknown>;
  /** Every RTU on this endpoint. Serve them all, not just the first. */
  readonly bindings: readonly RtuBinding[];
  readonly logger: AdapterLogger;
  /** Aborted on shutdown and on supervisor restart. Honour it in every await that can hang. */
  readonly signal: AbortSignal;
};

/** Hand samples to the host. Never call before `subscribe()` resolves, or after `disconnect()`. */
export type EmitSamples = (samples: readonly SourceSample[]) => void;

/**
 * A live adapter instance, bound to one endpoint.
 *
 * Implement `subscribe` (push) **or** `defaultPollIntervalMs` + `poll` (poll),
 * never both halves — `mode` says which. The host schedules the next poll only
 * after the previous one settles, so an adapter never needs to guard against
 * overlap and must never schedule itself.
 */
export type IngestAdapter = {
  readonly mode: AdapterMode;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Must not throw synchronously, and must not derive `detail` from credentials. */
  health(): AdapterHealth;
  /** Push adapters only. */
  subscribe?(emit: EmitSamples): Promise<void>;
  /** Poll adapters only. The host may override the interval per deployment. */
  readonly defaultPollIntervalMs?: number;
  /** Poll adapters only. Resolves with everything read this tick. */
  poll?(): Promise<readonly SourceSample[]>;
  /** Optional; only for protocols that can genuinely browse. */
  discover?(): Promise<readonly DiscoveredPoint[]>;
};

/**
 * How the host constructs an adapter, and what it can know without
 * constructing one.
 *
 * `supportsDiscovery` is a property of the *factory* precisely so `F3.24` can
 * filter the protocol list without opening a connection to find out.
 */
export type IngestAdapterFactory = {
  readonly protocol: IngestProtocol;
  readonly supportsDiscovery?: boolean;
  create(context: AdapterContext): IngestAdapter;
};
