import type { OnboardingProtocol } from "./index";
import { INGEST_PROTOCOLS } from "./ingest-protocols";

/**
 * Ingest data contracts (ADR 0016, backlog `F1.1`).
 *
 * These are the types consumed **outside** `apps/ingest` — `F3.24a`'s onboarding
 * agent and the `/admin/*` RTU screens need to name protocols and describe
 * config shapes. Since `F3.24a` (ADR 0093 decision 4) the module also carries
 * zod schemas: the MQTT adapter's config and device schemas live in
 * `./ingest-adapters/mqtt` and are re-exported here, so the ingest adapter and
 * the onboarding validator and tools read one schema. The adapter interface itself (`IngestAdapter`,
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

// The protocol union (ADR 0016 §7). A leaf module since `E7.2`, so the uplink
// schema below can read it without importing this module back.
export { INGEST_PROTOCOLS, type IngestProtocol } from "./ingest-protocols";

// `F4.221`: the one MQTT wildcard predicate. A leaf module, so the MQTT schemas
// below import it without importing this module back (`F3.24a` review).
export { mqttTopicHasWildcard } from "./mqtt-topic";

// `F3.24a` (ADR 0093 decision 4): the MQTT config, device and draft schemas.
export * from "./ingest-adapters/mqtt";
// `F3.24b` (ADR 0103): the envelope parse, shared with the discovery collector.
export * from "./ingest-adapters/mqtt-envelope";
// `F4.334` (ADR 0116): the payload format catalog's definition schema and decoder.
export * from "./ingest-adapters/mqtt-payload-format";
// `F4.343` (ADR 0119): the binary kind's schema, decoder and the hex sample parser.
export * from "./ingest-adapters/mqtt-payload-format-binary";
// `F3.24a` (ADR 0093 decisions 2, 3): the code-defined protocol catalog.
export * from "./protocol-catalog";
// `E7.2` (ADR 0123 decision 4): the edge-to-cloud uplink wire schema.
export * from "./ingest-uplink";
// `E7.2` (ADR 0123 decision 3): the edge gateway's configuration file schema.
export * from "./ingest-edge-config";
// `F3.16` (ADR 0127 decision 8): the six drop reasons, so the host counts the
// same list migration `0149`'s CHECKs hold. A leaf module with no zod.
export { DROP_REASONS, type DropReason } from "./device-health";

/**
 * Compile-time drift guard: every ingest protocol must be expressible in
 * onboarding, or `F3.24a` could offer a protocol nothing can ingest.
 *
 * The converse does not hold — `simulator` and `catalog` are onboarding
 * sources with no adapter, which is why this is an assignment and not an
 * equality.
 */
const _ingestProtocolsAreOnboardable: readonly OnboardingProtocol[] = INGEST_PROTOCOLS;
void _ingestProtocolsAreOnboardable;

/**
 * How recent a WRITTEN reading must be to raise a `pg_notify` on
 * `bms_telemetry` — the only mechanism that reaches `AlarmEngineService` (it
 * evaluates exclusively off `TelemetryBroadcastHub`'s `"readings"` event, fed
 * exclusively by `LISTEN bms_telemetry`; there is no other path from
 * `point_values` to alarm evaluation).
 *
 * Gated on the READING's own timestamp, not on which caller or path wrote it:
 * a manual entry backdated three weeks should no more raise a live alarm than
 * an imported one should, and a bulk import whose last few rows happen to be
 * timestamped seconds ago legitimately should. Five minutes is wider than the
 * web client's own 25 s live-staleness window
 * (`apps/web/src/lib/schematic-telemetry.ts`'s `FRESH_MS`) — that constant
 * governs socket freshness for a UI already streaming; this one has to absorb
 * the human latency of typing a reading in, which the socket case never pays.
 *
 * Moved here from `apps/api/src/admin/telemetry-entry/telemetry-write.service.ts`
 * by `E7.2` (ADR 0123 decision 10), because it gained a second consumer: the
 * ingest host's `writeResolved` now applies the same rule to every row it
 * writes, so an `F1.10` replay or an edge backlog lands in history without
 * raising a live alarm. The host's window is configurable
 * (`INGEST_NOTIFY_LIVE_WINDOW_MS`, bounded) and defaults to this value.
 */
export const NOTIFY_LIVE_WINDOW_MS = 5 * 60_000;

/**
 * The bounds on the ingest host's live window (plan P4, ruled as recommended).
 * They live here, beside the default, because two things enforce them: the
 * start-up read of `INGEST_NOTIFY_LIVE_WINDOW_MS` and `writeResolved` itself,
 * so a caller that does not go through the host config cannot pass a window
 * of zero and silence every notification.
 */
export const MIN_NOTIFY_LIVE_WINDOW_MS = 60_000;
export const MAX_NOTIFY_LIVE_WINDOW_MS = 900_000;

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
   * Omit it otherwise — a fabricated timestamp is worse than an honest absence.
   *
   * Since **ADR 0061** the host does not substitute receive time here: it
   * stamps the receive time onto the row's `time` for every sample, and stores
   * this value beside it in `telemetry.point_values.device_time`, unclamped and
   * uncorrected. An absent `at` therefore means `device_time IS NULL`, not
   * "receive time was copied in".
   *
   * **There is deliberately no receive-time field on this type.** The host
   * carries it in its own `ReceivedSample` wrapper, because an adapter that
   * could set a receive time could fabricate one, which
   * `adapter-contract.spec.ts` forbids.
   */
  readonly at?: Date;
  /** Protocol quality flag. `false` → the host discards the sample and counts it. */
  readonly good?: boolean;
};

/**
 * `F2.7` / ADR 0056 Q3 — a two-valued policy on the protocol's quality bit
 * (`SourceSample.good`), resolved per point as
 * `coalesce(asset_points.quality_policy, template_points.quality_policy)`.
 *
 * `discard_bad` is today's rule and what a `NULL` column reads as: a
 * `good: false` sample is dropped and counted (`badQuality`). `accept_bad`
 * stores it. The host is the only thing that acts on the value, and nothing it
 * needs could be carried as a column of a lookup table, so this is a closed
 * vocabulary by AGENTS.md §4.8's test: `as const` here, `z.enum` in
 * `contracts/point-metadata.ts`, a CHECK in migration `0063`.
 *
 * Here and not in `contracts/`, because the host imports this zod-free module
 * and the policy is the host's own rule; the contract side builds its schema
 * from this array rather than restating it.
 */
export const QUALITY_POLICIES = ["discard_bad", "accept_bad"] as const;

export type QualityPolicy = (typeof QUALITY_POLICIES)[number];

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
 * `discover()` is optional; `F3.24b` filters on the factory's
 * `supportsDiscovery` flag so it never has to construct an instance to find
 * out.
 */
export type DiscoveredPoint = {
  readonly sourceKey: string;
  readonly label?: string;
  readonly unit?: string;
  /** A live reading, so `F3.24b` can show an operator the value while they map the point. */
  readonly sampleValue?: number;
};

/**
 * Reconnect backoff policy (ADR 0016 §5).
 *
 * Lives here rather than in `apps/ingest` because it has **two** consumers: the
 * ingest supervisor, and the API's `bms_telemetry` NOTIFY listener (`F4.34`).
 * The ADR states the numbers precisely "so five agents do not invent five
 * policies", so a second copy would have defeated the point of writing them
 * down — and a prose "keep these in sync" note is exactly the guarantee §4.4
 * says to make structural instead.
 *
 * Moved here from `apps/ingest/src/host/backoff.ts` by `F4.34`. Its spec moved
 * with it unchanged apart from the import line, which is what shows the move
 * was faithful.
 */
export type BackoffPolicy = {
  readonly baseMs: number;
  readonly factor: number;
  readonly capMs: number;
  /** Fractional band, e.g. `0.2` for ±20%. */
  readonly jitter: number;
};

/** The ADR 0016 §5 table, verbatim. */
export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 1_000,
  factor: 2,
  capMs: 60_000,
  jitter: 0.2,
};

/**
 * Delay before retry number `attempt` (0-based: `0` is the first retry).
 *
 * Exponential from `baseMs`, capped at `capMs`, then spread ±`jitter` at
 * random within that band. Jitter is what stops an outage turning every
 * consumer into a synchronised thundering herd when it recovers.
 *
 * **The cap is a hard ceiling.** Jitter is applied after the exponential is
 * capped, so the upper bound is clamped back to `capMs` rather than allowed to
 * reach `capMs × 1.2`. A delay is therefore never longer than the ADR's stated
 * 60 s, at the cost of a slight downward bias once the cap is reached — which
 * is the right trade: a supervisor that waits *longer* than its documented
 * ceiling is the surprising failure.
 *
 * `random` is injected rather than `Math.random` so the spread is testable.
 */
export function backoffDelayMs(
  attempt: number,
  random: () => number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): number {
  const exponential = policy.baseMs * policy.factor ** Math.max(0, attempt);
  const capped = Math.min(policy.capMs, exponential);
  const band = capped * policy.jitter;
  const jittered = capped - band + random() * 2 * band;
  return Math.round(Math.min(policy.capMs, Math.max(0, jittered)));
}
