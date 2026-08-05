import type { OnboardingProtocol } from "./index";

/**
 * Ingest data contracts (ADR 0016, backlog `F1.1`).
 *
 * These are the types consumed **outside** `apps/ingest` — `F3.24`'s onboarding
 * agent and the `/admin/*` RTU screens need to name protocols and describe
 * config shapes. The adapter interface itself (`IngestAdapter`,
 * `AdapterContext`, `RtuBinding`) deliberately lives in
 * `apps/ingest/src/adapter/types.ts`: nothing outside `apps/ingest` implements
 * or calls it, and exporting it would widen the shared surface for no consumer
 * (ADR 0016 §8).
 *
 * Its own module rather than an addition to `index.ts`, for the two reasons
 * ADR 0016 §8 gives: `index.ts` is the package's single point of churn and sits
 * near the AGENTS.md §4.5 line cap, and the `exports` map needs a subpath entry
 * for a new module either way — so the packaging cost buys a real boundary.
 */

/**
 * Protocols an ingest adapter can serve.
 *
 * A protocol appears here only when an adapter could plausibly be written for
 * it; `modbus_rtu` and `dcs` are deliberately absent until `F1.6` needs them.
 * Adding one is a one-line change made by the adapter's own PR (ADR 0016 §7).
 */
export const INGEST_PROTOCOLS = [
  "mqtt",
  "modbus_tcp",
  "bacnet",
  "opc_ua",
  "snmp",
  "rest_poller",
] as const;

export type IngestProtocol = (typeof INGEST_PROTOCOLS)[number];

/**
 * Compile-time drift guard: every ingest protocol must be expressible in
 * onboarding, or `F3.24` could offer a protocol nothing can ingest.
 *
 * The converse does not hold — `simulator` and `catalog` are onboarding
 * sources with no adapter, which is why this is an assignment and not an
 * equality.
 */
const _ingestProtocolsAreOnboardable: readonly OnboardingProtocol[] = INGEST_PROTOCOLS;
void _ingestProtocolsAreOnboardable;

/**
 * Whether the host drives the adapter (`poll`) or the adapter drives the host
 * (`push`).
 *
 * An adapter declares exactly one and implements the matching half of the
 * interface: `subscribe` for push, `defaultPollIntervalMs` + `poll` for poll.
 * Never both — the host owns cadence either way (ADR 0016 §5).
 */
export type AdapterMode = "push" | "poll";

/**
 * One raw reading, keyed as the **device** names it — that is,
 * `bms.asset_points.source_data_key`, not a `point_key`.
 *
 * An adapter's total output is `SourceSample[]`. It never resolves an asset, a
 * point key or a unit; the host owns that lookup and the write (ADR 0016 §2).
 * That single clause is what makes six protocol adapters safe to build in
 * parallel.
 */
export type SourceSample = {
  readonly sourceKey: string;
  readonly value: number;
  /**
   * Which device produced this, when one adapter instance serves several
   * (MQTT `dev_id`, Modbus unit id, OPC-UA node prefix). Required when the
   * instance has more than one binding; omit when it has exactly one.
   */
  readonly deviceKey?: string;
  /**
   * Device timestamp, set **only** where the protocol genuinely carries one.
   * Omit it otherwise — the host substitutes receive time, and a fabricated
   * timestamp is worse than an honest absence.
   */
  readonly at?: Date;
  /** Protocol quality flag. `false` → the host discards the sample and counts it. */
  readonly good?: boolean;
};

/**
 * Operator-facing adapter state, consumed by `F3.16` (device health).
 *
 * **Never carries secrets.** `detail` must not be derived from
 * `context.credentials` — AGENTS.md §9.6, and ADR 0016 §9 makes it a
 * mechanically asserted conformance test rather than a review note.
 */
export type AdapterHealth = {
  readonly state: "connected" | "degraded" | "disconnected";
  readonly detail?: string;
  readonly lastSampleAt?: Date;
};

/**
 * A point an adapter found by browsing, for protocols that can browse (OPC-UA
 * can, an SNMP walk can, Modbus generally cannot).
 *
 * `discover()` is optional; `F3.24` filters on the factory's
 * `supportsDiscovery` flag so it never has to construct an instance to find
 * out.
 */
export type DiscoveredPoint = {
  readonly sourceKey: string;
  readonly label?: string;
  readonly unit?: string;
  /** A live reading, so `F3.24` can show an operator the value while they map the point. */
  readonly sampleValue?: number;
};
