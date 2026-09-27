import { describe, it } from "vitest";

import {
  runOperationalSiteJoinedPumpStationTest,
  runOperationalSiteUnjoinedRsmocTest,
} from "./map-site.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("map-site", () => {
  it("treats a pin that joins a location as operational, whatever its type (F4.157 W1)", () => {
    runOperationalSiteJoinedPumpStationTest();
  });

  it("treats a pin that joins no location as not operational, even an rsmoc one (F4.157 W2)", () => {
    runOperationalSiteUnjoinedRsmocTest();
  });
});
