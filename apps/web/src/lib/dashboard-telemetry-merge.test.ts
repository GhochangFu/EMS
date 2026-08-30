import { describe, it } from "vitest";

import {
  runDuplicateOverlapIsRemovedTests,
  runManyDuplicatesAreAllRemovedTests,
  runNoOverlayTests,
  runOverlayExtendsForwardTests,
} from "./dashboard-telemetry-merge.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("dashboard telemetry merge", () => {
  it("returns the seed alone, oldest-first, when there is no overlay", () => {
    runNoOverlayTests();
  });

  it("lets a genuinely newer live sample extend the seed forward", () => {
    runOverlayExtendsForwardTests();
  });

  it("removes a sample a window-focus refetch re-supplied, rather than drawing it twice", () => {
    runDuplicateOverlapIsRemovedTests();
  });

  it("removes every duplicate when a refetch re-supplies the whole live overlay", () => {
    runManyDuplicatesAreAllRemovedTests();
  });
});
