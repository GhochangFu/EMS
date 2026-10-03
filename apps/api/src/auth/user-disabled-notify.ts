import type { BackoffPolicy } from "@bms/shared";

import {
  createNotifyListener,
  reason,
  type ListenerClient,
  type ListenerLogger,
  type ListenerState,
  type NotifyListener,
} from "../database/notify-listener";

/**
 * `F3.78` / ADR 0089 decision 8 — `NOTIFY bms_user_disabled, '<users.id>'`
 * closes that user's open sockets on every API process, on the generic
 * `F4.34` `LISTEN` loop.
 *
 * The deactivate route (plan U5) sends the notification in the transaction
 * that sets `disabled_at`, so it is delivered on commit. REST is already
 * closed by then — the guard reads `disabled_at` on every request — and this
 * channel closes the long-lived sockets that would otherwise keep streaming.
 *
 * **The payload is the bare uuid, and it is never logged.** `NOTIFY` needs no
 * table privilege, so what arrives here is data of unknown provenance; an
 * undecodable one is dropped with a fixed warn. The worst a forged valid
 * payload does is close a socket, which the client re-opens — and the
 * handshake re-checks `disabled_at`, so an enabled user simply reconnects.
 */
export const USER_DISABLED_NOTIFY_CHANNEL = "bms_user_disabled";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The user id the payload names, or `null` for anything but a bare uuid. */
export function decodeUserDisabledNotification(raw: string | undefined): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw : null;
}

export type UserDisabledHandlerDeps = {
  /** `SocketRegistry.disconnectUser`. */
  disconnectUser(userId: string): number;
  logger: ListenerLogger;
};

/** Decodes one payload and closes that user's sockets; a bad payload is one fixed warn. */
export function handleUserDisabledNotification(
  raw: string | undefined,
  deps: UserDisabledHandlerDeps,
): void {
  const userId = decodeUserDisabledNotification(raw);
  if (userId === null) {
    deps.logger.warn(`Dropped an undecodable ${USER_DISABLED_NOTIFY_CHANNEL} payload`);
    return;
  }
  const closed = deps.disconnectUser(userId);
  deps.logger.log(`${USER_DISABLED_NOTIFY_CHANNEL}: closed ${closed} socket(s) for user ${userId}`);
}

export type UserDisabledCatchUpDeps = UserDisabledHandlerDeps & {
  /** `SocketRegistry.connectedUserIds` — the users holding a socket on this process. */
  connectedUserIds(): string[];
  /** Which of `ids` are deactivated now: one read on the auth pool. */
  readDisabledUserIds(ids: readonly string[]): Promise<string[]>;
};

/**
 * The catch-up on connect (`F3.78` security review). `NOTIFY` is not queued
 * for a session that is not listening, so a deactivation committed while this
 * process's `LISTEN` connection is down — in a reconnect backoff, or before
 * the first `LISTEN` after boot — never arrives here, and the gateways do not
 * re-check a socket after its handshake. Each transition to `connected`
 * therefore reads which of the users holding a socket here are deactivated
 * now, and closes theirs. Returns how many sockets it closed.
 */
export async function closeSocketsOfDisabledUsers(deps: UserDisabledCatchUpDeps): Promise<number> {
  const ids = deps.connectedUserIds();
  if (ids.length === 0) {
    return 0;
  }
  const disabled = await deps.readDisabledUserIds(ids);
  let closed = 0;
  for (const userId of disabled) {
    closed += deps.disconnectUser(userId);
  }
  if (disabled.length > 0) {
    deps.logger.log(
      `${USER_DISABLED_NOTIFY_CHANNEL}: catch-up on connect closed ${closed} socket(s) for ${disabled.length} deactivated user(s)`,
    );
  }
  return closed;
}

export type UserDisabledListenerDeps = UserDisabledCatchUpDeps & {
  /** A fresh client per attempt — `pg.Client` is not reusable after `end()`. */
  createClient(): ListenerClient;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now?: () => number;
  random?: () => number;
  policy?: BackoffPolicy;
  stableMs?: number;
  onStateChange?(state: ListenerState): void;
  onReconnectAttempt?(): void;
};

/** Builds the listener. Nothing runs until `start()`. */
export function createUserDisabledListener(deps: UserDisabledListenerDeps): NotifyListener {
  return createNotifyListener({
    ...deps,
    channel: USER_DISABLED_NOTIFY_CHANNEL,
    onNotification: (raw) => handleUserDisabledNotification(raw, deps),
    // `onStateChange` is synchronous, so the catch-up promise is voided with
    // its own `.catch` — the `alarm-notify.ts` reason: an unhandled rejection
    // from here would take the API down through the loop meant to keep it up.
    onStateChange: (state) => {
      deps.onStateChange?.(state);
      if (state === "connected") {
        void closeSocketsOfDisabledUsers(deps).catch((error: unknown) => {
          deps.logger.warn(`${USER_DISABLED_NOTIFY_CHANNEL}: catch-up on connect failed: ${reason(error)}`);
        });
      }
    },
  });
}
