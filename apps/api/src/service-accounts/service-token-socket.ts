import { parseServiceToken } from "./service-token-codec";

/**
 * `F4.17` / ADR 0125 decisions 12 and 13 — what a Socket.IO handshake does
 * for a `bms_sat_` token, shared by both gateways (security review of PR 4,
 * M1 and L2).
 *
 * 1. **Tag before verifying.** `tagServiceTokenSocket` stores the token id on
 *    the socket synchronously, before the handshake's first `await`, so a
 *    revoke NOTIFY that lands while the token is being verified finds and
 *    closes the socket instead of missing an untagged one.
 * 2. **Re-check once registered.** `holdServiceTokenSocket` reads the token
 *    fresh (`bms_auth` sees live tokens only) after the scope is resolved, the
 *    `isUserDisabled` pattern: a revoke that committed between the verify and
 *    the registration is caught here. It also arms a timer that closes the
 *    socket when the token expires — an open socket must not outlive a
 *    mandatory expiry.
 */

export type TokenSocket = {
  data: { serviceTokenId?: unknown };
  disconnect(close?: boolean): unknown;
  once(event: "disconnect", listener: () => void): unknown;
};

export type TokenFacts = Readonly<{ tokenId: string; expiresAt: number }>;

export type LiveTokenCheck = { isLive(tokenId: string): Promise<boolean> };

/** Tags a socket with the id of the token it presents (undefined for a JWT). */
export function tagServiceTokenSocket(client: TokenSocket, token: string): void {
  client.data.serviceTokenId = parseServiceToken(token)?.tokenId;
}

/** Longest single `setTimeout` delay Node accepts (about 24.8 days); longer waits re-arm. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * For a socket that authenticated with a token: `false` (and the socket is
 * closed) when the token is no longer live; otherwise `true`, with the expiry
 * timer armed. A JWT socket (`facts` null) is untouched and kept.
 */
export async function holdServiceTokenSocket(
  client: TokenSocket,
  facts: TokenFacts | null,
  verifier: LiveTokenCheck | undefined,
  now: () => number = Date.now,
): Promise<boolean> {
  if (!facts) {
    client.data.serviceTokenId = undefined;
    return true;
  }
  if (!verifier || !(await verifier.isLive(facts.tokenId))) {
    client.disconnect(true);
    return false;
  }
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    const remaining = facts.expiresAt - now();
    if (remaining <= 0) {
      client.disconnect(true);
      return;
    }
    timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
    timer.unref?.();
  };
  arm();
  client.once("disconnect", () => {
    if (timer) clearTimeout(timer);
  });
  return true;
}
