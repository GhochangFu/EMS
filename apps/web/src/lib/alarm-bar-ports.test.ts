import { afterEach, describe, it, vi } from "vitest";

import * as spec from "./alarm-bar-ports.spec";

vi.mock("./live-socket", () => ({ openLiveSocket: vi.fn() }));

/** `F4.357` U4 — Vitest entry point. Assertions live in `alarm-bar-ports.spec.ts` (ADR 0014). */
describe("alarm bar browser ports (F4.357)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it("the socket goes to /ws/alarms with the token and reaches the feed", () => spec.theSocketReachesTheFeed());
  it("the list read is the unacknowledged read of popup rank", () => spec.theListReadIsTheUnacknowledgedRead());
  it("the summary read sends the scope", () => spec.theSummaryReadSendsTheScope());
});
