import { mqttPlaintextDecision, onboardingDiscoveryStoredSchema, type OnboardingDiscoveryErrorClass } from "@bms/shared";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { readEncryptedCredentials, rtuSecretKey } from "../admin/onboarding/onboarding-redaction";
import type { BmsTx } from "../database/tenant-context";
import type { ProcessorContinuation } from "../queue/queue-processor";
import type { PayloadOf } from "../queue/queue-registry";
import type { onboardingDiscoveryQueue } from "../queue/onboarding-discovery";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import { MQTT_PLAINTEXT_ALLOWLIST } from "../security/mqtt-plaintext-hosts";
import { looksLikeCredential } from "../security/credential-detect";
import { createDiscoveryCollector, type CollectorResult, type DiscoveryFormat } from "./discovery-collector";
import { readDiscoveryCredentials, type DiscoveryCredentials } from "./discovery-credentials";
import { checkPort } from "./discovery-host-guard";
import { DiscoveryJobStore, type StoredDiscovery } from "./discovery-job-store";
import { listenForDevices, type ListenOutcome } from "./discovery-listener";
import {
  buildConnectOptions,
  DISCOVERY_TRANSPORT,
  DISCOVERY_TRANSPORT_OPTIONS,
  type DiscoveryTransportOptions,
  type MqttDiscoveryTransport,
} from "./discovery-transport";

export type DiscoveryJobPayload = PayloadOf<typeof onboardingDiscoveryQueue>;

/** Refusal classes the job writes (ADR 0103 decision 9; `bad credential` is Amendment 1's, C1). */
type JobRefusal = "blocked host" | "bad port" | "bad credential" | "plaintext not allowed";

/** An error's `name` only — never its message, which may hold broker or SQL text (L1, §9.6). */
function errorName(err: unknown): string {
  return typeof err === "object" && err !== null ? String((err as { name?: unknown }).name) : "unknown";
}

type Prepared = {
  readonly stored: StoredDiscovery;
  readonly address: string;
  readonly typedHost: string;
  readonly port: number;
  readonly credentials: DiscoveryCredentials;
  /** ADR 0114 decision 4: connect `mqtt` rather than `mqtts`. */
  readonly plaintext: boolean;
  /** `F4.334` / ADR 0116 decision 8: the catalog formats, the RTU's chosen one first. */
  readonly formats: readonly DiscoveryFormat[];
};

/**
 * `F3.24b` (ADR 0103 decisions 3–9, Amendment 1) — the `onboarding-discovery`
 * processor body.
 *
 * **Phase A, on `runProcessor`'s tenant transaction.** Lock the session row;
 * do nothing (log ids only) when RLS hides it, it is no longer a draft, or
 * `draft._discovery` is not this discovery still `queued` — a superseded or
 * re-delivered job. Then the RTU, its credentials (decrypted here, only the
 * string `username` and `password`, refused on a control character — C1),
 * the port, and the host guard (`DiscoveryTransportOptions.resolve`). A guard
 * hit writes `failed` and one `onboarding.discovery.refuse` row; a host that
 * does not resolve writes `failed` / `host unreachable` and one `finish` row.
 * Otherwise it writes `running` and returns the window as a continuation.
 *
 * **Phase B, after that commit** (the broker window must not hold a tenant
 * backend for up to 120 s): connect to the checked address, listen, then a
 * second tenant transaction writes `done` or `failed` and one `finish` row —
 * in a `finally`, so a throw anywhere in the window still leaves `failed`
 * and a `finish` row rather than a `running` that only the stale bound ends.
 *
 * **Neither `run` nor the continuation rejects (L1).** Every error after
 * decrypt is mapped to a class; a throw in phase A hands back a continuation
 * that writes `failed` and a `finish` row; a failed final write is logged by
 * error name only. A rejection
 * would put its message and stack in BullMQ's `failedReason` in Redis.
 *
 * Logs carry ids, statuses and counts only — never a host, a credential, a
 * broker message or a sample value (AGENTS.md §9.6).
 */
@Injectable()
export class DiscoveryJobService {
  private readonly logger = new Logger("DiscoveryJob");

  constructor(
    private readonly crypto: CredentialCryptoService,
    private readonly store: DiscoveryJobStore,
    @Inject(DISCOVERY_TRANSPORT) private readonly transport: MqttDiscoveryTransport,
    @Inject(DISCOVERY_TRANSPORT_OPTIONS) private readonly transportOptions: DiscoveryTransportOptions,
    // F4.326 / ADR 0114 decision 4: `MQTT_PLAINTEXT_HOSTS`, parsed. Optional so a
    // bare construction fails closed (no host may connect plain); the module
    // registers the throwing provider, so a bad entry refuses the worker's boot.
    @Optional()
    @Inject(MQTT_PLAINTEXT_ALLOWLIST)
    private readonly plaintextHosts: ReadonlySet<string> = new Set<string>(),
  ) {}

  async run(payload: DiscoveryJobPayload, tx: BmsTx): Promise<void | ProcessorContinuation> {
    let prepared: Prepared | null;
    try {
      prepared = await this.prepare(payload, tx);
    } catch (err) {
      // The phase-A crash path. `queued` has no stale bound and one discovery
      // per organization is allowed, so a rejection here (which rolls the
      // transaction back) would leave the discovery `queued` and the
      // organization blocked for ever. Resolve instead: Postgres turns the
      // COMMIT of a transaction a failed statement aborted into a ROLLBACK,
      // and the continuation writes `failed` and one `finish` row in a fresh
      // transaction. The error's text goes nowhere (L1).
      this.logger.error(`discovery failed before connect: ${errorName(err)} ${this.ids(payload)}`);
      return { afterCommit: () => this.finishCrashed(payload) };
    }
    if (prepared === null) {
      return;
    }
    const ready = prepared;
    return { afterCommit: () => this.listenAndFinish(payload, ready) };
  }

  /** After a phase-A throw: `failed` (when the discovery is still this one) and one `finish` row. Never throws. */
  private async finishCrashed(payload: DiscoveryJobPayload): Promise<void> {
    try {
      await this.store.inTenant(payload.organizationId, async (tx) => {
        const locked = await this.store.lock(tx, payload.sessionId);
        if (!locked || locked.status !== "draft") {
          return;
        }
        const current = onboardingDiscoveryStoredSchema.safeParse((locked.draft as Record<string, unknown>)._discovery);
        if (!current.success || current.data.discoveryId !== payload.discoveryId) {
          return;
        }
        await this.fail(tx, payload, current.data, undefined);
      });
    } catch (err) {
      this.logger.error(`discovery crash write failed: ${errorName(err)} ${this.ids(payload)}`);
    }
  }

  private ids(payload: DiscoveryJobPayload): string {
    return `discoveryId=${payload.discoveryId} sessionId=${payload.sessionId}`;
  }

  private async prepare(payload: DiscoveryJobPayload, tx: BmsTx): Promise<Prepared | null> {
    const locked = await this.store.lock(tx, payload.sessionId);
    if (!locked || locked.status !== "draft") {
      this.logger.log(`discovery skipped: no draft session ${this.ids(payload)}`);
      return null;
    }
    const draft = locked.draft as Record<string, unknown>;
    const parsed = onboardingDiscoveryStoredSchema.safeParse(draft._discovery);
    if (!parsed.success || parsed.data.discoveryId !== payload.discoveryId || parsed.data.status !== "queued") {
      this.logger.log(`discovery skipped: superseded or not queued ${this.ids(payload)}`);
      return null;
    }
    const stored = parsed.data;

    const rtus = Array.isArray(draft.rtus) ? (draft.rtus as unknown[]) : [];
    const index = rtus.findIndex(
      (r) => typeof r === "object" && r !== null && String((r as { code?: unknown }).code ?? "").trim() === payload.rtuCode,
    );
    const rtu = rtus[index] as { protocol?: unknown; config?: Record<string, unknown> } | undefined;
    const config = rtu?.config ?? {};
    const host = typeof config.host === "string" ? config.host.trim() : "";
    if (rtu === undefined || rtu.protocol !== "mqtt" || host.length === 0 || rtuSecretKey(draft, index) === null) {
      await this.fail(tx, payload, stored, undefined);
      return null;
    }
    // F4.326 security review L1: the TLS choice the user confirmed at the route
    // travels in the payload. A draft changed since (e.g. switched to
    // `tls: false` after a "TLS: on" card) fails before any connection; the
    // user starts the discovery again from a card that shows the change.
    if ((config.tls !== false) !== (payload.tls ?? true)) {
      this.logger.log(`discovery failed: the TLS choice changed since it was confirmed ${this.ids(payload)}`);
      await this.fail(tx, payload, stored, undefined);
      return null;
    }
    if (!checkPort(config.port)) {
      await this.refuse(tx, payload, stored, host, config.port, "bad port", undefined);
      return null;
    }
    const port = config.port;

    let credentials: DiscoveryCredentials = {};
    const encrypted = readEncryptedCredentials(draft, index);
    if (encrypted !== null) {
      let record: unknown;
      try {
        record = this.crypto.decrypt(encrypted.ciphertext, encrypted.iv, encrypted.keyVersion);
      } catch {
        this.logger.warn(`discovery failed: credentials could not be decrypted ${this.ids(payload)}`);
        await this.fail(tx, payload, stored, undefined);
        return null;
      }
      const read = readDiscoveryCredentials(record);
      if (!read.ok) {
        await this.refuse(tx, payload, stored, host, port, "bad credential", undefined);
        return null;
      }
      credentials = read.credentials;
    }

    const resolution = await this.transportOptions.resolve(host);
    if (!resolution.ok) {
      if (resolution.error === "blocked host") {
        await this.refuse(tx, payload, stored, host, port, "blocked host", "blocked host");
      } else {
        await this.fail(tx, payload, stored, "host unreachable");
      }
      return null;
    }

    // ADR 0114 decision 4: after the host guard, the plain-MQTT rule. Only the
    // literal `tls: false` on a listed host connects `mqtt`; an unlisted one is
    // refused before any connection and never tried with TLS instead.
    const transport = mqttPlaintextDecision(config.tls, host, this.plaintextHosts);
    if (transport === "refused") {
      await this.refuse(tx, payload, stored, host, port, "plaintext not allowed", "plaintext not allowed");
      return null;
    }

    // F4.334 (ADR 0116 decision 8): every catalog format, the draft RTU's own
    // `payloadFormat` first. An invalid row is left out and named by code only.
    const chosen = typeof config.payloadFormat === "string" ? config.payloadFormat : undefined;
    const catalog = await this.store.formats(tx, chosen);
    for (const code of catalog.invalid) {
      this.logger.warn(`discovery: payload format ${code} fails the schema and is not tried ${this.ids(payload)}`);
    }

    const running: StoredDiscovery = { ...stored, status: "running", startedAt: new Date().toISOString() };
    await this.store.writeDiscovery(tx, payload.sessionId, running);
    return {
      stored: running,
      address: resolution.address,
      typedHost: host,
      port,
      credentials,
      plaintext: transport === "plain",
      formats: catalog.formats,
    };
  }

  private async listenAndFinish(payload: DiscoveryJobPayload, prepared: Prepared): Promise<void> {
    const secrets = [prepared.credentials.username, prepared.credentials.password].filter(
      (s): s is string => s !== undefined,
    );
    const collector = createDiscoveryCollector({ secrets, formats: prepared.formats });
    let outcome: ListenOutcome = { kind: "failed" };
    try {
      outcome = await listenForDevices({
        transport: this.transport,
        options: buildConnectOptions(
          {
            address: prepared.address,
            typedHost: prepared.typedHost,
            port: prepared.port,
            discoveryId: payload.discoveryId,
            credentials: prepared.credentials,
            plaintext: prepared.plaintext,
          },
          this.transportOptions,
        ),
        filter: `${payload.topicPrefix}/#`,
        windowMs: payload.windowSeconds * 1000,
        collector,
      });
    } catch {
      outcome = { kind: "failed" };
    } finally {
      await this.finish(payload, prepared.stored, collector.result(), outcome);
    }
  }

  /** The second transaction: the final status and one `finish` row. Never throws. */
  private async finish(
    payload: DiscoveryJobPayload,
    stored: StoredDiscovery,
    result: CollectorResult,
    outcome: ListenOutcome,
  ): Promise<void> {
    const status = outcome.kind === "done" ? "done" : "failed";
    const error = outcome.kind === "failed" ? outcome.error : undefined;
    try {
      await this.store.inTenant(payload.organizationId, async (tx) => {
        const locked = await this.store.lock(tx, payload.sessionId);
        const current = onboardingDiscoveryStoredSchema.safeParse(
          (locked?.draft as Record<string, unknown> | undefined)?._discovery,
        );
        // Only the discovery this job ran is updated; a newer one (or a
        // committed session) keeps its own state. The finish row is written
        // either way: the connection was opened.
        if (locked?.status === "draft" && current.success && current.data.discoveryId === payload.discoveryId) {
          const final: StoredDiscovery = {
            ...stored,
            status,
            finishedAt: new Date().toISOString(),
            truncated: result.truncated,
            devices: result.devices,
            messages: result.messages,
            skipped: result.skipped,
            skippedReasons: result.skippedReasons,
            ...(error === undefined ? {} : { error }),
          };
          await this.store.writeDiscovery(tx, payload.sessionId, final);
        }
        await this.store.audit(tx, {
          organizationId: payload.organizationId,
          sessionId: payload.sessionId,
          action: "onboarding.discovery.finish",
          payload: {
            discoveryId: payload.discoveryId,
            rtuCode: payload.rtuCode,
            status,
            ...(error === undefined ? {} : { error }),
            truncated: result.truncated,
            devices: result.devices.length,
            keys: result.keys,
            messages: result.messages,
            skipped: result.skipped,
            skippedReasons: result.skippedReasons,
          },
        });
      });
      this.logger.log(
        `discovery finished: status=${status} devices=${result.devices.length} keys=${result.keys} messages=${result.messages} skipped=${result.skipped} ${this.ids(payload)}`,
      );
    } catch (err) {
      this.logger.error(`discovery finish write failed: ${errorName(err)} ${this.ids(payload)}`);
      await this.finishFallback(payload, stored);
    }
  }

  /**
   * F3.24b review — the full result could not be written (Postgres refused a
   * value in it, or the transaction failed). Write `failed` with no devices
   * and one `finish` row in a fresh transaction, so the discovery does not
   * stay `running` until its stale bound. Never throws.
   */
  private async finishFallback(payload: DiscoveryJobPayload, stored: StoredDiscovery): Promise<void> {
    try {
      await this.store.inTenant(payload.organizationId, async (tx) => {
        const locked = await this.store.lock(tx, payload.sessionId);
        const current = onboardingDiscoveryStoredSchema.safeParse(
          (locked?.draft as Record<string, unknown> | undefined)?._discovery,
        );
        if (locked?.status !== "draft" || !current.success || current.data.discoveryId !== payload.discoveryId) {
          return;
        }
        await this.fail(tx, payload, stored, undefined);
      });
    } catch (err) {
      this.logger.error(`discovery fallback write failed: ${errorName(err)} ${this.ids(payload)}`);
    }
  }

  /** A phase-A failure that is not a refusal: `failed`, then one `finish` row. */
  private async fail(
    tx: BmsTx,
    payload: DiscoveryJobPayload,
    stored: StoredDiscovery,
    error: OnboardingDiscoveryErrorClass | undefined,
  ): Promise<void> {
    await this.store.writeDiscovery(tx, payload.sessionId, this.failed(stored, error));
    await this.store.audit(tx, {
      organizationId: payload.organizationId,
      sessionId: payload.sessionId,
      action: "onboarding.discovery.finish",
      payload: {
        discoveryId: payload.discoveryId,
        rtuCode: payload.rtuCode,
        status: "failed",
        ...(error === undefined ? {} : { error }),
        truncated: false,
        devices: 0,
        keys: 0,
        messages: 0,
        skipped: 0,
      },
    });
    this.logger.log(`discovery failed before connect: ${error ?? "no class"} ${this.ids(payload)}`);
  }

  /** A guard hit: `failed`, then one `refuse` row (decision 9). */
  private async refuse(
    tx: BmsTx,
    payload: DiscoveryJobPayload,
    stored: StoredDiscovery,
    host: string,
    port: unknown,
    refusal: JobRefusal,
    error: OnboardingDiscoveryErrorClass | undefined,
  ): Promise<void> {
    await this.store.writeDiscovery(tx, payload.sessionId, this.failed(stored, error));
    await this.store.audit(tx, {
      organizationId: payload.organizationId,
      sessionId: payload.sessionId,
      action: "onboarding.discovery.refuse",
      payload: {
        discoveryId: payload.discoveryId,
        rtuCode: payload.rtuCode,
        // A host that reads as a credential (`user:pw@…` typed into the host
        // field) is left out rather than stored.
        ...(looksLikeCredential(host) ? {} : { host }),
        ...(typeof port === "number" && Number.isFinite(port) ? { port } : {}),
        topicFilter: stored.topicFilter,
        refusal,
      },
    });
    this.logger.log(`discovery refused: ${refusal} ${this.ids(payload)}`);
  }

  private failed(stored: StoredDiscovery, error: OnboardingDiscoveryErrorClass | undefined): StoredDiscovery {
    const { error: _previous, ...rest } = stored;
    return {
      ...rest,
      status: "failed",
      finishedAt: new Date().toISOString(),
      ...(error === undefined ? {} : { error }),
    };
  }
}
