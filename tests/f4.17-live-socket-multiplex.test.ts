import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { refuseRateLimitedHandshake } from "../apps/api/src/rate-limit/handshake-limit";
import { openLiveSocket } from "../apps/web/src/lib/live-socket";

/**
 * `F4.17` / ADR 0125, plan §11 — the enforce gate, against the real libraries.
 *
 * The SPA's sockets share one base URL, so socket.io-client multiplexes
 * `/ws/alarms` and `/ws/telemetry` over one engine connection. A refusal
 * that closed the whole connection (`disconnect(true)`) also disconnected
 * the sibling namespace, which got no `rate_limited` event and so never
 * reconnected: the alarm rail died with the refused telemetry socket. A fake
 * socket cannot show that (code review 1), so this runs the real
 * `socket.io` server with the real `refuseRateLimitedHandshake` and the
 * SPA's real `openLiveSocket` over a real WebSocket.
 *
 * `socket.io` is resolved through `apps/api`'s manifest (no workspace depends
 * on both packages); the client comes in through the helper, so both sockets
 * share the helper's own `socket.io-client` instance and its Manager cache.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const apiRequire = createRequire(join(repoRoot, "apps", "api", "package.json"));

/** The slice of `socket.io`'s server this test drives; its types do not resolve from `tests/`. */
type IoServer = {
  of(name: string): { on(event: "connection", handler: (socket: unknown) => void): unknown };
  close(): unknown;
  httpServer: { address(): unknown };
};
const { Server } = apiRequire("socket.io") as {
  Server: new (port: number, options: { transports: string[] }) => IoServer;
};

type Limiter = Parameters<typeof refuseRateLimitedHandshake>[0];

/** Refuses the first telemetry handshake, admits everything after it. */
function refuseOnce(): Limiter {
  let refused = false;
  return {
    mode: "enforce",
    config: { trustProxyHops: 0 },
    async checkIp() {
      if (refused) return { refuse: false };
      refused = true;
      return { refuse: true, refusal: { bucket: "ws", limit: 30, windowMs: 60_000, resetMs: 1_000 } };
    },
  } as unknown as Limiter;
}

function until(predicate: () => boolean, ms: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) resolve();
      else if (Date.now() - started > ms) reject(new Error(`timed out after ${ms} ms`));
      else setTimeout(tick, 20);
    };
    tick();
  });
}

describe("F4.17 — a rate-limited namespace recovers and its sibling stays up (real socket.io)", () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
    vi.restoreAllMocks();
  });

  it("reconnects the refused telemetry socket and never drops the alarms socket", { timeout: 20_000 }, async () => {
    // No jitter, so the retry comes after exactly retryAfterSeconds (1 s).
    vi.spyOn(Math, "random").mockReturnValue(0);
    const server = new Server(0, { transports: ["websocket"] });
    closers.push(() => void server.close());
    const limiter = refuseOnce();
    server.of("/ws/alarms").on("connection", () => undefined);
    server.of("/ws/telemetry").on("connection", (socket) => {
      void refuseRateLimitedHandshake(limiter, socket as Parameters<typeof refuseRateLimitedHandshake>[1]);
    });
    const port = (server.httpServer.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const alarms = openLiveSocket(`${base}/ws/alarms`, { transports: ["websocket"] });
    closers.push(() => alarms.disconnect());
    const alarmDrops: string[] = [];
    alarms.on("disconnect", (reason) => alarmDrops.push(reason));
    await until(() => alarms.connected, 5_000);

    const telemetry = openLiveSocket(`${base}/ws/telemetry`, { transports: ["websocket"] });
    closers.push(() => telemetry.disconnect());
    let telemetryConnects = 0;
    let refusals = 0;
    telemetry.on("connect", () => {
      telemetryConnects += 1;
    });
    telemetry.on("rate_limited", () => {
      refusals += 1;
    });
    expect(telemetry.io, "the two namespaces share one Manager, as in the SPA").toBe(alarms.io);

    await until(() => refusals === 1 && telemetryConnects >= 2 && telemetry.connected, 8_000);
    expect(alarmDrops, "the refusal must not disconnect the sibling namespace").toEqual([]);
    expect(alarms.connected).toBe(true);
  });
});
