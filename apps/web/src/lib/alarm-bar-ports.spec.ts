import { expect, vi } from "vitest";

import { browserAlarmBarPorts } from "./alarm-bar-ports";
import { openLiveSocket } from "./live-socket";

/**
 * `F4.357` U4 — the browser ports. `./live-socket` is mocked by the sibling
 * `.test.ts` (`vi.mock` is hoisted per file), so `openLiveSocket` here is a
 * `vi.fn` returning a recorded fake socket.
 */

type Handler = (...args: unknown[]) => void;

/** A fake Socket.IO socket: `on` records handlers, `disconnect` is a spy. */
export function fakeSocket() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    on: vi.fn((name: string, handler: Handler) => void handlers.set(name, handler)),
    disconnect: vi.fn(),
  };
}

/** The socket goes to `/ws/alarms` with the token; `alarm`, `connect` and `disconnect` reach the feed; close disconnects. */
export function theSocketReachesTheFeed(): void {
  const socket = fakeSocket();
  vi.mocked(openLiveSocket).mockReturnValue(socket as unknown as ReturnType<typeof openLiveSocket>);
  const on = { event: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
  const handle = browserAlarmBarPorts().openSocket("token-1", on);
  const [url, options] = vi.mocked(openLiveSocket).mock.calls[0] ?? [];
  expect(url).toMatch(/\/ws\/alarms$/);
  expect(options).toEqual({ transports: ["websocket"], auth: { token: "token-1" } });
  socket.handlers.get("alarm")?.({ type: "created" });
  socket.handlers.get("connect")?.();
  socket.handlers.get("disconnect")?.("transport close");
  expect([on.event.mock.calls.length, on.connect.mock.calls.length, on.disconnect.mock.calls.length]).toEqual([1, 1, 1]);
  handle.close();
  expect(socket.disconnect).toHaveBeenCalledTimes(1);
}

/** The list read is the unacknowledged read of popup rank, 50 rows, in the scope. */
export async function theListReadIsTheUnacknowledgedRead(): Promise<void> {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
  });
  await browserAlarmBarPorts().fetchList({ locationId: "22222222-2222-4222-8222-222222222222" });
  const params = new URL(seen).searchParams;
  expect({
    state: params.get("state"),
    minSeverityRank: params.get("minSeverityRank"),
    limit: params.get("limit"),
    locationId: params.get("locationId"),
  }).toEqual({ state: "unacknowledged", minSeverityRank: "20", limit: "50", locationId: "22222222-2222-4222-8222-222222222222" });
}

/** The summary read goes to the summary path with the scope. */
export async function theSummaryReadSendsTheScope(): Promise<void> {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  });
  await browserAlarmBarPorts().fetchSummary({ organizationId: "11111111-1111-4111-8111-111111111111" });
  const url = new URL(seen);
  expect([url.pathname, url.searchParams.get("organizationId")]).toEqual(["/api/v1/alarms/summary", "11111111-1111-4111-8111-111111111111"]);
}
