import type { BackoffPolicy } from "@bms/shared";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import {
  createNotifyListener,
  reason,
  type ListenerClient,
  type ListenerLogger,
  type ListenerState,
  type NotifyListener,
} from "../database/notify-listener";

/**
 * `F4.17` / ADR 0125 decision 13 — a revoked token stops working on every API
 * process within one NOTIFY round trip. The revoke (PR 5) sends
 * `NOTIFY bms_service_token_revoked, '<token id>'` in its own transaction, so
 * the notification is delivered only if the revoke commits; each process
 * drops that token from its verifier cache and closes its sockets.
 *
 * The same shape as `bms_user_disabled` (`../auth/user-disabled-notify.ts`):
 * a NOTIFY sent while this LISTEN connection is down is lost, so every
 * (re)connect clears the whole verifier cache and closes the sockets of any
 * connected token that is no longer live. This is fan-in, not a sweep, so it
 * runs in every replica (`F4.128` is about sweeps).
 */

export const SERVICE_TOKEN_REVOKED_CHANNEL = "bms_service_token_revoked";

const TOKEN_ID = /^[A-Za-z0-9]{12}$/;

/** The token id a notification names, or `null` for anything else. */
export function decodeServiceTokenRevoked(raw: string | undefined): string | null {
  return typeof raw === "string" && TOKEN_ID.test(raw) ? raw : null;
}

/** Sends the revoke notification inside the caller's transaction. */
export async function notifyServiceTokenRevoked(tx: Pick<BmsDb, "execute">, tokenId: string): Promise<void> {
  if (!TOKEN_ID.test(tokenId)) {
    throw new Error("notifyServiceTokenRevoked: not a token id");
  }
  await tx.execute(sql`SELECT pg_notify(${SERVICE_TOKEN_REVOKED_CHANNEL}, ${tokenId})`);
}

export type ServiceTokenRevokedDeps = {
  forget(tokenId: string): void;
  forgetAll(): void;
  disconnectServiceToken(tokenId: string): number;
  /** `SocketRegistry.connectedServiceTokenIds`. */
  connectedServiceTokenIds(): string[];
  /** Which of `ids` are still live: one read on the auth pool (its policy sees live tokens only). */
  readLiveTokenIds(ids: readonly string[]): Promise<string[]>;
  logger: ListenerLogger;
};

/** One `bms_service_token_revoked` notification: forget that token and close its sockets. */
export function handleServiceTokenRevoked(raw: string | undefined, deps: ServiceTokenRevokedDeps): void {
  const tokenId = decodeServiceTokenRevoked(raw);
  if (tokenId === null) {
    deps.logger.warn(`Dropped an undecodable ${SERVICE_TOKEN_REVOKED_CHANNEL} payload`);
    return;
  }
  deps.forget(tokenId);
  const closed = deps.disconnectServiceToken(tokenId);
  // The token id is the public half and safe to log; the secret never reaches here.
  deps.logger.log(`${SERVICE_TOKEN_REVOKED_CHANNEL}: closed ${closed} socket(s) for token ${tokenId}`);
}

/** The catch-up on every (re)connect. */
export async function catchUpServiceTokens(deps: ServiceTokenRevokedDeps): Promise<number> {
  deps.forgetAll();
  const ids = deps.connectedServiceTokenIds();
  if (ids.length === 0) {
    return 0;
  }
  const live = new Set(await deps.readLiveTokenIds(ids));
  let closed = 0;
  for (const tokenId of ids) {
    if (!live.has(tokenId)) {
      closed += deps.disconnectServiceToken(tokenId);
    }
  }
  return closed;
}

export type ServiceTokenListenerDeps = ServiceTokenRevokedDeps & {
  createClient(): ListenerClient;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now?: () => number;
  random?: () => number;
  policy?: BackoffPolicy;
  stableMs?: number;
  onStateChange?(state: ListenerState): void;
};

/** The LISTEN client for revokes, with the catch-up on every (re)connect. */
export function createServiceTokenRevokedListener(deps: ServiceTokenListenerDeps): NotifyListener {
  return createNotifyListener({
    ...deps,
    channel: SERVICE_TOKEN_REVOKED_CHANNEL,
    onNotification: (raw) => handleServiceTokenRevoked(raw, deps),
    onStateChange: (state) => {
      deps.onStateChange?.(state);
      if (state === "connected") {
        void catchUpServiceTokens(deps).catch((error: unknown) => {
          deps.logger.warn(`${SERVICE_TOKEN_REVOKED_CHANNEL}: catch-up on connect failed: ${reason(error)}`);
        });
      }
    },
  });
}
