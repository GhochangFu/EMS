import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedWriteThrows,
  createPostsTheBody,
  extendEndCancelHitTheirPaths,
  listOmitsAbsentKeys,
  listSendsStateAndScope,
} from "./maintenance-windows.spec";

/** `F4.359` U11 — the maintenance-window web client. `node` environment, like `alarms.test.ts`. */
describe("F4.359 maintenance windows web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("sends state and scope on the list read", () => listSendsStateAndScope());
  it("omits absent scope keys", () => listOmitsAbsentKeys());
  it("POSTs the create body", () => createPostsTheBody());
  it("POSTs extend, end and cancel to their paths", () => extendEndCancelHitTheirPaths());
  it("throws on a refused write", () => aFailedWriteThrows());
});
