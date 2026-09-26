// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  admitsAGlobalScope,
  admitsALocationScope,
  cleanupGuard,
  doesNotRedirectWhileScopeIsPending,
  redirectsANoneScope,
  showsAStatusLineWhileScopeIsPending,
} from "./control-room-scope-route.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.66 U2 ControlRoomScopeRoute", () => {
  afterEach(() => {
    cleanupGuard();
  });

  it("admits a global scope to the guarded children", () => {
    admitsAGlobalScope();
  });

  it("admits a location scope to the guarded children", () => {
    admitsALocationScope();
  });

  it("redirects a none scope to /", () => {
    redirectsANoneScope();
  });

  it("shows a status line while the scope is still pending (null)", () => {
    showsAStatusLineWhileScopeIsPending();
  });

  it("does not redirect while the scope is still pending (null)", () => {
    doesNotRedirectWhileScopeIsPending();
  });
});
