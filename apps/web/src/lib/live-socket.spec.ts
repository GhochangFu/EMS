import type { Socket } from "socket.io-client";
import { expect } from "vitest";

import { attachRateLimitReconnect, FALLBACK_RETRY_SECONDS, RECONNECT_JITTER_MS } from "./live-socket";

/**
 * `F4.17` / ADR 0125, plan §11 — the gate before `RATE_LIMIT_MODE=enforce`.
 *
 * A refused Socket.IO handshake is sent one `rate_limited` event (the 429
 * body) and then `disconnect(true)`. socket.io-client never reconnects after
 * a server disconnect, so without this every live feed on the page — the
 * alarm rail, the dashboards — would stay dead until a remount.
 */

type Handler = (...args: unknown[]) => void;

function fakeSocket() {
  const handlers = new Map<string, Handler[]>();
  const calls = { connect: 0, disconnect: 0 };
  const socket = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return socket;
    },
    connect() {
      calls.connect += 1;
      return socket;
    },
    disconnect() {
      calls.disconnect += 1;
      return socket;
    },
  };
  const fire = (name: string, ...args: unknown[]) => {
    for (const handler of handlers.get(name) ?? []) handler(...args);
  };
  return { socket: socket as unknown as Socket, calls, fire };
}

function fakeTimers(random = 0.5) {
  const pending = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  let next = 1;
  return {
    deps: {
      setTimeout: (run: () => void, ms: number) => {
        const id = next++;
        pending.set(id, { at: now + ms, run });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (id: ReturnType<typeof setTimeout> | undefined) => {
        if (id !== undefined) pending.delete(id as unknown as number);
      },
      random: () => random,
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.run();
        }
      }
    },
    pendingCount: () => pending.size,
  };
}

const REFUSAL = {
  statusCode: 429,
  error: "Too Many Requests",
  code: "rate_limited",
  message: "Too many requests. Try again in 12 seconds.",
  retryAfterSeconds: 12,
};

/** A refusal then the server's disconnect: one reconnect, after the wait plus jitter, and not before. */
export function reconnectsOnceAfterTheRetryAfterWait(): void {
  const { socket, calls, fire } = fakeSocket();
  const timers = fakeTimers(0.5);
  attachRateLimitReconnect(socket, timers.deps);
  fire("rate_limited", REFUSAL);
  fire("disconnect", "io server disconnect");
  const delay = 12_000 + Math.floor(0.5 * RECONNECT_JITTER_MS);
  timers.advance(delay - 1);
  expect(calls.connect, "no reconnect before Retry-After has passed").toBe(0);
  timers.advance(1);
  expect(calls.connect, "exactly one reconnect after the wait").toBe(1);
  timers.advance(600_000);
  expect(calls.connect, "the reconnect is not repeated").toBe(1);
}

/** A server disconnect with no refusal is not ours to undo (an auth failure, a token revoke). */
export function leavesOtherServerDisconnectsAlone(): void {
  const { socket, calls, fire } = fakeSocket();
  const timers = fakeTimers();
  attachRateLimitReconnect(socket, timers.deps);
  fire("disconnect", "io server disconnect");
  timers.advance(600_000);
  expect(calls.connect).toBe(0);
  expect(timers.pendingCount()).toBe(0);
}

/** A refusal followed by a transport drop leaves the retry to socket.io-client's own reconnection. */
export function onlyAServerDisconnectSchedulesTheRetry(): void {
  const { socket, calls, fire } = fakeSocket();
  const timers = fakeTimers();
  attachRateLimitReconnect(socket, timers.deps);
  fire("rate_limited", REFUSAL);
  fire("disconnect", "transport close");
  timers.advance(600_000);
  expect(calls.connect).toBe(0);
}

/** The caller's own disconnect (an unmount) cancels a pending reconnect and still disconnects. */
export function theCallersDisconnectCancelsThePendingReconnect(): void {
  const { socket, calls, fire } = fakeSocket();
  const timers = fakeTimers();
  attachRateLimitReconnect(socket, timers.deps);
  fire("rate_limited", REFUSAL);
  fire("disconnect", "io server disconnect");
  expect(timers.pendingCount()).toBe(1);
  socket.disconnect();
  expect(calls.disconnect, "the original disconnect still runs").toBe(1);
  expect(timers.pendingCount(), "the pending reconnect is cleared").toBe(0);
  timers.advance(600_000);
  expect(calls.connect).toBe(0);
}

/** A body that does not parse (a version mismatch) still reconnects, after the fallback wait. */
export function aMalformedRefusalFallsBackToTheDefaultWait(): void {
  const { socket, calls, fire } = fakeSocket();
  const timers = fakeTimers(0);
  attachRateLimitReconnect(socket, timers.deps);
  fire("rate_limited", { code: "rate_limited" });
  fire("disconnect", "io server disconnect");
  timers.advance(FALLBACK_RETRY_SECONDS * 1000 - 1);
  expect(calls.connect).toBe(0);
  timers.advance(1);
  expect(calls.connect).toBe(1);
}

/** A refusal followed by a transport drop is spent: a later server disconnect schedules nothing (code review 4). */
export function aSpentRefusalDoesNotOutliveItsDisconnect(): void {
  const { socket, calls, fire } = fakeSocket();
  const timers = fakeTimers();
  attachRateLimitReconnect(socket, timers.deps);
  fire("rate_limited", REFUSAL);
  fire("disconnect", "transport close");
  fire("disconnect", "io server disconnect");
  timers.advance(600_000);
  expect(calls.connect).toBe(0);
  expect(timers.pendingCount()).toBe(0);
}

/** A second refusal after the reconnect schedules a second retry: no state is left over. */
export function aSecondRefusalSchedulesAgain(): void {
  const { socket, calls, fire } = fakeSocket();
  const timers = fakeTimers(0);
  attachRateLimitReconnect(socket, timers.deps);
  fire("rate_limited", REFUSAL);
  fire("disconnect", "io server disconnect");
  timers.advance(12_000);
  fire("rate_limited", { ...REFUSAL, retryAfterSeconds: 3 });
  fire("disconnect", "io server disconnect");
  timers.advance(3_000);
  expect(calls.connect).toBe(2);
}
