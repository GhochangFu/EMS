import type { Socket } from "socket.io";

import { clientAddress } from "./rate-limit-key";
import type { RateLimiterService } from "./rate-limiter.service";
import { rateLimitedBody } from "./rate-limited.exception";

/**
 * `F4.17` / ADR 0125 decision 2 — Stage 1 on the Socket.IO handshake, the
 * same `ws` bucket for both namespaces. It runs **before** the token is
 * verified, so a flood of connections costs one Redis call each and no
 * signature check or database read.
 *
 * The handshake has no `req.ip`, so the client address is derived with the
 * same hop-count rule Express applies (`clientAddress`). A refused socket is
 * sent one `rate_limited` event carrying the 429 body, then disconnected.
 *
 * Returns `true` when the connection was refused (and is already closed).
 */
export async function refuseRateLimitedHandshake(
  limiter: RateLimiterService | undefined,
  client: Socket,
): Promise<boolean> {
  if (!limiter || limiter.mode === "off") {
    return false;
  }
  const address = clientAddress(
    client.handshake.address,
    client.handshake.headers["x-forwarded-for"],
    limiter.config.trustProxyHops,
  );
  const decision = await limiter.checkIp("ws", address);
  if (!decision.refuse) {
    return false;
  }
  client.emit("rate_limited", rateLimitedBody(decision.refusal));
  client.disconnect(true);
  return true;
}
