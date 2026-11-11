import { rateLimitedErrorSchema } from "@bms/shared";
import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";

/**
 * `F4.17` / ADR 0125, plan §11 — the one way the SPA opens a Socket.IO
 * connection, so a rate-limited handshake recovers on its own.
 *
 * When the API refuses a handshake (`apps/api/src/rate-limit/handshake-limit.ts`)
 * it emits one `rate_limited` event carrying the 429 body, then disconnects
 * that namespace (only that one — the SPA's namespaces share a connection).
 * socket.io-client treats a server disconnect as final and never reconnects,
 * so without this a live feed — the alarm rail, a dashboard, the map — stays
 * dead until its component remounts. That was the gate before
 * `RATE_LIMIT_MODE=enforce`.
 *
 * The retry waits `retryAfterSeconds` plus up to {@link RECONNECT_JITTER_MS},
 * so the sockets of one page (and of one site behind one NAT) do not all
 * return in the same instant and spend the bucket again. A disconnect the
 * caller makes (an unmount, a token change) cancels a pending retry.
 *
 * Tests: `live-socket.spec.ts` (the state machine, on a fake socket);
 * `tests/f4.17-live-socket-multiplex.test.ts` (the real server and client:
 * the refused namespace reconnects and its sibling on the same connection
 * stays up); `tests/f4.17-live-socket-only.test.ts` (no other file imports a
 * value from `socket.io-client`).
 */

/** Spread over the reconnects of one refusal window. */
export const RECONNECT_JITTER_MS = 5_000;

/** The wait when the refusal body does not parse (a version mismatch between the ends). */
export const FALLBACK_RETRY_SECONDS = 60;

type Timers = {
  setTimeout: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout> | undefined) => void;
  random: () => number;
};

const realTimers: Timers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (id) => clearTimeout(id),
  random: () => Math.random(),
};

/** Wires the retry onto a socket. Exported for the spec; callers use {@link openLiveSocket}. */
export function attachRateLimitReconnect(socket: Socket, timers: Timers = realTimers): Socket {
  let refusedForSeconds: number | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  socket.on("rate_limited", (body: unknown) => {
    const parsed = rateLimitedErrorSchema.safeParse(body);
    refusedForSeconds = parsed.success ? parsed.data.retryAfterSeconds : FALLBACK_RETRY_SECONDS;
  });

  socket.on("disconnect", (reason: Socket.DisconnectReason) => {
    // A refusal belongs to the disconnect that follows it, whatever its reason,
    // so a stale one never schedules a retry for a later, unrelated disconnect.
    const waitSeconds = refusedForSeconds;
    refusedForSeconds = undefined;
    // Any other reason is socket.io-client's to retry, or not ours to undo.
    if (reason !== "io server disconnect" || waitSeconds === undefined || closed) {
      return;
    }
    const delay = waitSeconds * 1000 + Math.floor(timers.random() * RECONNECT_JITTER_MS);
    timers.clearTimeout(pending);
    pending = timers.setTimeout(() => {
      pending = undefined;
      if (!closed) {
        socket.connect();
      }
    }, delay);
  });

  const disconnect = socket.disconnect.bind(socket);
  socket.disconnect = (() => {
    closed = true;
    timers.clearTimeout(pending);
    pending = undefined;
    return disconnect();
  }) as Socket["disconnect"];

  return socket;
}

/** `io(url, options)`, plus the rate-limit reconnect. */
export function openLiveSocket(url: string, options?: Partial<ManagerOptions & SocketOptions>): Socket {
  return attachRateLimitReconnect(io(url, options));
}
