import { describe, it } from "vitest";

import {
  runNoClosedSectionTabTests,
  runRegistryShapeTests,
  runResolveTabTests,
} from "./template-tabs.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template tabs", () => {
  it("holds exactly the five tabs ADR 0038 names", () => {
    runRegistryShapeTests();
  });

  it("gives no tab to a reserved or deferred content section", () => {
    runNoClosedSectionTabTests();
  });

  it("falls back to Details for any ?tab= value it cannot honour", () => {
    runResolveTabTests();
  });
});
