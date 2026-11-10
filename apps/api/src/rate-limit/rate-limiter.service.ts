import { Logger } from "@nestjs/common";

import type { RateLimitHealth } from "@bms/shared";

import {
  RATE_LIMIT_WINDOW_MS,
  type IpBucket,
  type RateLimitClass,
  type RateLimitConfig,
} from "./rate-limit-config";
import { fixedWindow, ipSubject, rateLimitKey, type RateLimitStage } from "./rate-limit-key";
import type { RateLimitStore } from "./rate-limit-store";
import type { RateLimitRefusal } from "./rate-limited.exception";

/**
 * `F4.17` / ADR 0125 decisions 1, 5 and 7 — the one object both stages call.
 *
 * - `off`: nothing is counted and no store call is made.
 * - `shadow`: every request is counted; a would-be refusal is counted as
 *   `shadow_refused` and logged once per subject per window, and the request
 *   proceeds.
 * - `enforce`: a request over its limit is refused.
 *
 * The decision is returned, never thrown, so the HTTP middleware, the guard
 * and the Socket.IO handshake each refuse in their own shape.
 */

export type RateLimitOutcome = "allowed" | "refused" | "shadow_refused";

export type RateLimitDecision =
  | Readonly<{ refuse: false }>
  | Readonly<{ refuse: true; refusal: RateLimitRefusal }>;

/** The metric sink — `MetricsService` in the app, a spy in the specs. */
export type RateLimitMetrics = {
  recordRateLimitDecision(stage: RateLimitStage, bucket: string, outcome: RateLimitOutcome): void;
};

const ALLOW: RateLimitDecision = { refuse: false };
const MAX_SHADOW_LOG_KEYS = 10_000;

export class RateLimiterService {
  private readonly logger = new Logger("RateLimiter");
  private readonly shadowLogged = new Set<string>();

  constructor(
    readonly config: RateLimitConfig,
    private readonly store: RateLimitStore,
    private readonly metrics: RateLimitMetrics | null,
  ) {}

  get mode(): RateLimitConfig["mode"] {
    return this.config.mode;
  }

  health(): RateLimitHealth {
    return { store: this.store.state };
  }

  /** Stage 1 — per client IP. `address` is `req.ip` or the handshake's derived address. */
  checkIp(bucket: IpBucket, address: string | undefined): Promise<RateLimitDecision> {
    return this.check("ip", bucket, ipSubject(address), this.config.ipLimits[bucket]);
  }

  /**
   * Stage 2 — per identity. `subject` is the resolved `bms.users.id` (or, for
   * a principal with no row, `sub:<token subject>`).
   */
  checkIdentity(rateLimitClass: RateLimitClass, subject: string): Promise<RateLimitDecision> {
    return this.check("identity", rateLimitClass, subject, this.config.classLimits[rateLimitClass]);
  }

  private async check(
    stage: RateLimitStage,
    bucket: string,
    subject: string,
    limit: number,
  ): Promise<RateLimitDecision> {
    if (this.config.mode === "off") {
      return ALLOW;
    }
    const windowMs = RATE_LIMIT_WINDOW_MS;
    const { index } = fixedWindow(this.store.clock(), windowMs);
    const key = rateLimitKey(stage, bucket, subject, index);
    const hit = await this.store.hit(key, windowMs);

    if (hit.count <= limit) {
      this.metrics?.recordRateLimitDecision(stage, bucket, "allowed");
      return ALLOW;
    }

    const refusal: RateLimitRefusal = { bucket, limit, windowMs, resetMs: hit.resetMs };
    if (this.config.mode === "shadow") {
      this.metrics?.recordRateLimitDecision(stage, bucket, "shadow_refused");
      this.logShadowOnce(key, stage, bucket, limit);
      return ALLOW;
    }
    this.metrics?.recordRateLimitDecision(stage, bucket, "refused");
    return { refuse: true, refusal };
  }

  /**
   * One line per key (subject + bucket + window), so a client hammering in
   * shadow mode logs once a minute, not once a request. The subject itself is
   * not logged: it is a user id or a client address, and the metric already
   * carries the count (AGENTS.md §9.6).
   */
  private logShadowOnce(key: string, stage: RateLimitStage, bucket: string, limit: number): void {
    if (this.shadowLogged.has(key)) {
      return;
    }
    if (this.shadowLogged.size >= MAX_SHADOW_LOG_KEYS) {
      this.shadowLogged.clear();
    }
    this.shadowLogged.add(key);
    this.logger.warn(
      `shadow: a ${stage} subject passed the ${bucket} limit of ${limit} per minute (not refused)`,
    );
  }
}
