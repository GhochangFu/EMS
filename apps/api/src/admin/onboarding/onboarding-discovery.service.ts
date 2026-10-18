import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { SafeParseReturnType } from "zod";

import { MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS } from "@bms/shared";
import type {
  JwtPayload,
  OnboardingDiscoveryStored,
  StartOnboardingDiscoveryBody,
  StartOnboardingDiscoveryResponseDto,
} from "@bms/shared";

import type { BmsTx } from "../../database/tenant-context";
import { checkPort, isBlockedHostname } from "../../onboarding-discovery/discovery-host-guard";
import { discoveryJobId, onboardingDiscoveryQueue } from "../../queue/onboarding-discovery";
import { enqueue, type PayloadOf, type QueueClient } from "../../queue/queue-registry";
import { QUEUE_CLIENT } from "../../queue/queue.tokens";
import { looksLikeCredential } from "../../security/credential-detect";
import { MasterDataAuditService } from "../master-data-audit.service";
import { discoveryIsBusy, readStoredDiscovery } from "./onboarding-discovery-state";
import { OnboardingDiscoveryStore } from "./onboarding-discovery-store";
import { SESSION_NO_LONGER_DRAFT } from "./onboarding-locked-writes";
import { readEncryptedCredentials, rtuSecretKey } from "./onboarding-redaction";
import { OnboardingService } from "./onboarding.service";

export const DISCOVERY_NO_RTU = "This draft has no RTU with that code.";
export const DISCOVERY_NOT_MQTT = "Discovery runs on an MQTT RTU only.";
/** Decisions Q4: no connection target exists, so no refusal class fits and no audit row is written. */
export const DISCOVERY_NO_TARGET = "The RTU has no broker host and port in the draft. Set both, then start the discovery again.";
export const DISCOVERY_NO_CREDENTIALS = "Set the credentials of the RTU, then start the discovery again.";
export const DISCOVERY_BLOCKED_HOST = "Discovery cannot connect to that host.";
export const DISCOVERY_BAD_PORT = "The port of the RTU must be a whole number from 1 to 65535.";
/** Security review H3. */
export const DISCOVERY_TARGET_CHANGED =
  "The broker host or port of the RTU changed after this discovery was shown. Review it and start it again.";
export const DISCOVERY_BUSY = "A discovery is already queued or running in this organization. Wait for it to finish.";
export const DISCOVERY_NO_WORKER = "Discovery needs the background worker, and it is not available now.";

/** The refusal classes of ADR 0103 decision 9 this route writes (the worker writes its own). */
export type DiscoveryRefusal = "blocked host" | "bad port" | "bad prefix" | "busy" | "no worker";

/** An optional clock token: unprovided in the app, so `Date.now` applies; the spec passes a fixed one. */
export const DISCOVERY_CLOCK = Symbol("DISCOVERY_CLOCK");

type Start = { readonly discoveryId: string; readonly payload: PayloadOf<typeof onboardingDiscoveryQueue> };
type Decision = { readonly kind: "start"; readonly start: Start } | { readonly kind: "refuse"; readonly error: HttpException };

/**
 * `F3.24b` U3 (ADR 0103 decisions 2, 5, 7 and 9) — `POST
 * /admin/onboarding/sessions/:id/discovery`: checks the draft RTU, stores
 * `draft._discovery` as `queued`, audits the start and enqueues one
 * `onboarding-discovery` job. The worker does the rest.
 *
 * **The gate runs first (security review M5).** `loadSession` (the role gate,
 * then the uniform 404) runs before any refuse row, so no caller can write a
 * row into another organization or learn that an id exists. A body that did
 * not parse reaches here as the controller's `safeParse` result for that
 * reason; a refused prefix is audited as `bad prefix` with no prefix stored.
 *
 * **Every check reads the locked row.** The organization's advisory lock,
 * then the row lock, then the RTU, the guards, the confirmed target (H3) and
 * the busy rule — one session (M2) and one organization (M3) at a time. A
 * refusal writes its row and returns, so the transaction commits the row; the
 * error is thrown after it. A throw inside the transaction would roll the row
 * back.
 *
 * **The organization is the locked row's (M4)**: the job payload and every
 * audit row take it from there, never from the JWT or the body.
 *
 * **No credential.** The check reads only whether an encrypted blob exists;
 * the payload carries none (the queue schema is strict), and a host shaped
 * like `user:password@host` is left out of a row.
 */
@Injectable()
export class OnboardingDiscoveryService {
  private readonly logger = new Logger(OnboardingDiscoveryService.name);

  constructor(
    private readonly sessions: OnboardingService,
    private readonly store: OnboardingDiscoveryStore,
    private readonly audit: MasterDataAuditService,
    @Inject(QUEUE_CLIENT) private readonly queue: QueueClient,
    @Optional() @Inject(DISCOVERY_CLOCK) private readonly now: () => number = Date.now,
  ) {}

  async start(
    jwt: JwtPayload,
    sessionId: string,
    parsed: SafeParseReturnType<unknown, StartOnboardingDiscoveryBody>,
  ): Promise<StartOnboardingDiscoveryResponseDto> {
    const session = await this.sessions.loadSession(jwt, sessionId);
    if (session.status !== "draft") {
      throw new ForbiddenException("Session is not editable");
    }
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === "topicPrefix")) {
        await this.store.inTenant(session.organizationId, async (tx) => {
          const locked = await this.store.lock(tx, sessionId);
          if (locked) {
            await this.refuseRow(tx, jwt, locked.organizationId, sessionId, { refusal: "bad prefix" });
          }
        });
      }
      throw new BadRequestException(parsed.error.flatten());
    }
    const body = parsed.data;

    const decision = await this.store.inTenant(session.organizationId, (tx) =>
      this.decide(tx, jwt, session.organizationId, sessionId, body),
    );
    if (decision.kind === "refuse") {
      throw decision.error;
    }

    const { discoveryId, payload } = decision.start;
    try {
      await enqueue(this.queue, onboardingDiscoveryQueue, payload, { jobId: discoveryJobId(discoveryId) });
    } catch (err) {
      // The name only: a Redis error message can carry an address (AGENTS.md §9.6).
      this.logger.warn(`discovery enqueue failed: ${(err as Error)?.name ?? "Error"} discoveryId=${discoveryId}`);
      await this.markNotQueued(jwt, payload);
      throw new ServiceUnavailableException(DISCOVERY_NO_WORKER);
    }
    return { discoveryId };
  }

  private async decide(
    tx: BmsTx,
    jwt: JwtPayload,
    organizationId: string,
    sessionId: string,
    body: StartOnboardingDiscoveryBody,
  ): Promise<Decision> {
    await this.store.lockOrganization(tx, organizationId);
    const locked = await this.store.lock(tx, sessionId);
    if (!locked || locked.status !== "draft") {
      return { kind: "refuse", error: new ConflictException(SESSION_NO_LONGER_DRAFT) };
    }
    const orgId = locked.organizationId;
    const draft = locked.draft as Record<string, unknown>;
    const rtus = Array.isArray(draft.rtus) ? (draft.rtus as unknown[]) : [];
    const index = rtus.findIndex(
      (r) => typeof r === "object" && r !== null && String((r as { code?: unknown }).code ?? "").trim() === body.rtuCode,
    );
    const rtu = rtus[index] as { protocol?: unknown; config?: Record<string, unknown> } | undefined;
    if (rtu === undefined || rtuSecretKey(draft, index) === null) {
      return this.plain(new BadRequestException(DISCOVERY_NO_RTU));
    }
    if (rtu.protocol !== "mqtt") {
      return this.plain(new BadRequestException(DISCOVERY_NOT_MQTT));
    }
    const config = rtu.config ?? {};
    const host = typeof config.host === "string" ? config.host.trim() : "";
    if (host.length === 0 || config.port === undefined || config.port === null || config.port === "") {
      return this.plain(new BadRequestException(DISCOVERY_NO_TARGET));
    }
    if (readEncryptedCredentials(draft, index) === null) {
      return this.plain(new BadRequestException(DISCOVERY_NO_CREDENTIALS));
    }

    const topicFilter = `${body.topicPrefix}/#`;
    const where = {
      rtuCode: body.rtuCode,
      ...(looksLikeCredential(host) ? {} : { host }),
      ...(typeof config.port === "number" && Number.isFinite(config.port) ? { port: config.port } : {}),
      ...(looksLikeCredential(topicFilter) ? {} : { topicFilter }),
    };
    const refuse = async (refusal: DiscoveryRefusal, error: HttpException): Promise<Decision> => {
      await this.refuseRow(tx, jwt, orgId, sessionId, { ...where, refusal });
      return { kind: "refuse", error };
    };

    if (isBlockedHostname(host)) {
      return refuse("blocked host", new BadRequestException(DISCOVERY_BLOCKED_HOST));
    }
    if (!checkPort(config.port)) {
      return refuse("bad port", new BadRequestException(DISCOVERY_BAD_PORT));
    }
    const port = config.port;
    if (body.expected.host.trim() !== host || body.expected.port !== port) {
      return this.plain(new ConflictException(DISCOVERY_TARGET_CHANGED));
    }
    if (this.queue.kind === "unconfigured") {
      return refuse("no worker", new ServiceUnavailableException(DISCOVERY_NO_WORKER));
    }
    const nowMs = this.now();
    const elsewhere = await this.store.activeDiscoveriesElsewhere(tx, orgId, sessionId);
    const busy =
      discoveryIsBusy(readStoredDiscovery(draft), nowMs) ||
      elsewhere.some((blob) => discoveryIsBusy(readStoredDiscovery({ _discovery: blob }), nowMs));
    if (busy) {
      return refuse("busy", new ConflictException(DISCOVERY_BUSY));
    }

    const discoveryId = randomUUID();
    const windowSeconds = body.windowSeconds ?? MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS;
    const stored: OnboardingDiscoveryStored = {
      discoveryId,
      rtuCode: body.rtuCode,
      topicFilter,
      windowSeconds,
      status: "queued",
      startedAt: null,
      finishedAt: null,
      truncated: false,
      devices: [],
      queuedAt: new Date(nowMs).toISOString(),
      messages: 0,
      skipped: 0,
    };
    await this.store.writeDiscovery(tx, sessionId, stored);
    await this.audit.write(
      {
        actor: jwt,
        action: "onboarding.discovery.start",
        entityType: "onboarding_session",
        entityId: sessionId,
        organizationId: orgId,
        payload: { discoveryId, ...where, port, windowSeconds },
      },
      tx,
    );
    return {
      kind: "start",
      start: {
        discoveryId,
        payload: { organizationId: orgId, sessionId, rtuCode: body.rtuCode, discoveryId, topicPrefix: body.topicPrefix, windowSeconds },
      },
    };
  }

  /** A refusal with no audit row: a validation error or a stale card, not a guard hit. */
  private plain(error: HttpException): Decision {
    return { kind: "refuse", error };
  }

  /**
   * The enqueue failed after the `queued` row committed: the discovery goes
   * `failed` (no error class — no connection was tried) with one `no worker`
   * row, unless something has replaced it since.
   */
  private async markNotQueued(jwt: JwtPayload, payload: Start["payload"]): Promise<void> {
    await this.store.inTenant(payload.organizationId, async (tx) => {
      const locked = await this.store.lock(tx, payload.sessionId);
      const current = locked ? readStoredDiscovery(locked.draft) : null;
      if (!locked || current === null || current.discoveryId !== payload.discoveryId || current.status !== "queued") {
        return;
      }
      await this.store.writeDiscovery(tx, payload.sessionId, {
        ...current,
        status: "failed",
        finishedAt: new Date(this.now()).toISOString(),
      });
      await this.refuseRow(tx, jwt, locked.organizationId, payload.sessionId, {
        discoveryId: payload.discoveryId,
        rtuCode: current.rtuCode,
        ...(looksLikeCredential(current.topicFilter) ? {} : { topicFilter: current.topicFilter }),
        refusal: "no worker",
      });
    });
  }

  private refuseRow(
    tx: BmsTx,
    jwt: JwtPayload,
    organizationId: string,
    sessionId: string,
    payload: Record<string, unknown> & { refusal: DiscoveryRefusal },
  ): Promise<void> {
    return this.audit.write(
      {
        actor: jwt,
        action: "onboarding.discovery.refuse",
        entityType: "onboarding_session",
        entityId: sessionId,
        organizationId,
        payload,
      },
      tx,
    );
  }
}
