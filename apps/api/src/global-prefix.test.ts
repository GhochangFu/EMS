import { describe, it } from "vitest";

import {
  assertAnApiRouteIsStillPrefixed,
  assertMainPassesTheList,
  assertTheProbesAreUnprefixed,
} from "./global-prefix.spec";

/** `F4.175` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.175 — the global prefix leaves the probes unprefixed", () => {
  it("excludes GET /health, /health/ready and /metrics", () => {
    assertTheProbesAreUnprefixed();
  });

  it("keeps an API route under the prefix", () => {
    assertAnApiRouteIsStillPrefixed();
  });

  it("main.ts passes this list to setGlobalPrefix", () => {
    assertMainPassesTheList();
  });
});
