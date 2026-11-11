import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { serviceAccountTokens, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { AUTH_DRIZZLE } from "../database/database.tokens";
import { parseServiceToken, secretMatches } from "./service-token-codec";

/**
 * `F4.17` / ADR 0125 decisions 11–13 — turns a `bms_sat_` token into the
 * service account it belongs to, or `null`. **Never throws for a bad token**:
 * the guard answers every `null` with the same generic 401, so a caller cannot
 * tell an unknown id from a revoked, expired or mistyped token.
 *
 * - **Lookup** on the `bms_auth` pool, by the public `token_id`, before any
 *   organization is known. Migration `0145` scopes `bms_auth`'s policy to
 *   **live** tokens (not revoked, not expired), so a revoked or expired token
 *   is simply not found; the expiry and revocation tests below repeat it in
 *   code, so neither layer relies on the other.
 * - **Compare** the SHA-256 of the presented secret with the stored hash in
 *   constant time.
 * - **Account**: the owning row must be `kind = 'service'`, not disabled, and
 *   in the token's organization (the composite key already holds the last).
 * - **Cache** a verified token for at most 30 s (decision 13), keyed by token
 *   id and holding the stored hash, so every request still proves the secret.
 *   `forget` drops one entry on a `bms_service_token_revoked` NOTIFY.
 * - **`last_used_at`** is written at most once a minute per token per
 *   process, fire-and-forget: a failed touch never fails the request.
 */

export const SERVICE_TOKEN_CACHE_TTL_MS = 30_000;
export const LAST_USED_TOUCH_INTERVAL_MS = 60_000;
const MAX_CACHED_TOKENS = 10_000;

export type ServicePrincipal = Readonly<{
  /** The JWT-shaped principal the rest of the API reads (`req.user`). */
  payload: JwtPayload;
  /** The account's `bms.users` row, as `resolveIdentity` would return it. */
  identity: ResolvedIdentity;
  tokenId: string;
  readOnly: boolean;
}>;

type CacheEntry = {
  tokenHash: Buffer;
  identity: ResolvedIdentity;
  readOnly: boolean;
  expiresAt: number;
  cachedAt: number;
};

type TokenRow = {
  id: string;
  organizationId: string;
  serviceAccountId: string;
  tokenHash: Buffer;
  readOnly: boolean;
  expiresAt: Date;
  revokedAt: Date | null;
};

@Injectable()
export class ServiceTokenVerifier {
  private readonly logger = new Logger(ServiceTokenVerifier.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly lastTouch = new Map<string, number>();
  private touchFailureLogged = false;

  /** The clock — a field, not a constructor parameter, so Nest injects nothing for it. */
  now: () => number = Date.now;

  constructor(@Inject(AUTH_DRIZZLE) private readonly authDb: BmsDb) {}

  /** The principal for `token`, or `null` for any token that must not authenticate. */
  async verify(token: string): Promise<ServicePrincipal | null> {
    const parsed = parseServiceToken(token);
    if (!parsed) {
      return null;
    }
    const now = this.now();
    const cached = this.cache.get(parsed.tokenId);
    if (cached && now - cached.cachedAt < SERVICE_TOKEN_CACHE_TTL_MS && cached.expiresAt > now) {
      if (!secretMatches(parsed.secret, cached.tokenHash)) {
        return null;
      }
      this.touch(parsed.tokenId, now);
      return this.principal(parsed.tokenId, cached);
    }
    this.cache.delete(parsed.tokenId);

    const row = await this.readToken(parsed.tokenId);
    if (!row || row.revokedAt !== null || row.expiresAt.getTime() <= now) {
      return null;
    }
    if (!secretMatches(parsed.secret, row.tokenHash)) {
      return null;
    }
    const identity = await this.readAccount(row.serviceAccountId, row.organizationId);
    if (!identity) {
      return null;
    }
    const entry: CacheEntry = {
      tokenHash: Buffer.from(row.tokenHash),
      identity,
      readOnly: row.readOnly,
      expiresAt: row.expiresAt.getTime(),
      cachedAt: now,
    };
    if (this.cache.size >= MAX_CACHED_TOKENS) {
      this.cache.clear();
    }
    this.cache.set(parsed.tokenId, entry);
    this.touch(parsed.tokenId, now);
    return this.principal(parsed.tokenId, entry);
  }

  /** Drops one cached token (a revoke NOTIFY). */
  forget(tokenId: string): void {
    this.cache.delete(tokenId);
  }

  /** Drops every cached token (the LISTEN connection reconnected and may have missed a NOTIFY). */
  forgetAll(): void {
    this.cache.clear();
  }

  private principal(tokenId: string, entry: CacheEntry): ServicePrincipal {
    const { identity } = entry;
    return {
      payload: {
        sub: identity.id,
        email: identity.email,
        name: identity.displayName,
        role: identity.role,
      },
      identity,
      tokenId,
      readOnly: entry.readOnly,
    };
  }

  private async readToken(tokenId: string): Promise<TokenRow | null> {
    // An explicit column list: `bms_auth` holds SELECT on these columns only.
    const [row] = await this.authDb
      .select({
        id: serviceAccountTokens.id,
        organizationId: serviceAccountTokens.organizationId,
        serviceAccountId: serviceAccountTokens.serviceAccountId,
        tokenHash: serviceAccountTokens.tokenHash,
        readOnly: serviceAccountTokens.readOnly,
        expiresAt: serviceAccountTokens.expiresAt,
        revokedAt: serviceAccountTokens.revokedAt,
      })
      .from(serviceAccountTokens)
      .where(eq(serviceAccountTokens.tokenId, tokenId))
      .limit(1);
    return (row as TokenRow | undefined) ?? null;
  }

  private async readAccount(id: string, organizationId: string): Promise<ResolvedIdentity | null> {
    const [row] = await this.authDb
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        organizationId: users.organizationId,
        oidcSubject: users.oidcSubject,
        disabledAt: users.disabledAt,
        kind: users.kind,
      })
      .from(users)
      .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
      .limit(1);
    if (!row || row.kind !== "service" || row.disabledAt !== null) {
      return null;
    }
    // The CHECK holds a service row to these two; anything else is refused rather than trusted.
    if (row.role !== "viewer" && row.role !== "operator") {
      return null;
    }
    return { ...row, role: row.role as UserRole, kind: "service" };
  }

  private touch(tokenId: string, now: number): void {
    const last = this.lastTouch.get(tokenId);
    if (last !== undefined && now - last < LAST_USED_TOUCH_INTERVAL_MS) {
      return;
    }
    if (this.lastTouch.size >= MAX_CACHED_TOKENS) {
      this.lastTouch.clear();
    }
    this.lastTouch.set(tokenId, now);
    // The guard stamps now() whatever is written (migration 0145).
    void this.authDb
      .update(serviceAccountTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(serviceAccountTokens.tokenId, tokenId))
      .then(() => {
        this.touchFailureLogged = false;
      })
      .catch((err: unknown) => {
        if (!this.touchFailureLogged) {
          this.touchFailureLogged = true;
          this.logger.warn(
            `last_used_at touch failed (${err instanceof Error ? err.name : "unknown"}); the request was served`,
          );
        }
      });
  }
}
