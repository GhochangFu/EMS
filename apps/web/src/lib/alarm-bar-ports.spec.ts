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

/** The socket goes to `/ws/alarms` with the token; `alarm`, `connect`, a lost socket and a refused connect reach the feed; close disconnects. */
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
  socket.handlers.get("disconnect")?.("io client disconnect");
  socket.handlers.get("connect_error")?.(new Error("websocket error"));
  expect(
    [on.event.mock.calls.length, on.connect.mock.calls.length, on.disconnect.mock.calls.length],
    "our own close is not a lost socket; a refused connect is",
  ).toEqual([1, 1, 2]);
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

/** U6 — acknowledge is the existing route, once per id, with the reason in the body. */
export async function acknowledgeIsTheExistingRoute(): Promise<void> {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(
      JSON.stringify({
        id: "a1", assetId: null, ruleKey: null, ruleId: null, severity: "critical", message: "m", raisedAt: "2026-11-12T10:00:00.000Z",
        acknowledgedAt: "2026-11-12T10:01:00.000Z", acknowledgedBy: "u", clearedAt: null, assetCode: null, assetRtuName: null,
        assetLocationName: null, assetName: null, siteName: null, source: "ingest_host", rtuId: null, rtuCode: null,
        severityRank: 30, locationName: null, suppressed: false, maintenanceWindowId: null, unsuppressedAt: null,
      }),
      { status: 200 },
    );
  });
  await browserAlarmBarPorts().acknowledge("a1", "Checked on site");
  expect(seen).toHaveLength(1);
  expect(new URL(seen[0]!.url).pathname).toBe("/api/v1/alarms/a1/ack");
  expect([seen[0]!.init?.method, JSON.parse(String(seen[0]!.init?.body))]).toEqual(["POST", { reason: "Checked on site" }]);
}
