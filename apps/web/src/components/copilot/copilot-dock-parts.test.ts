import { describe, it } from "vitest";

import { aDiscoveryCardDropsTheCachedCommitCard, aTurnWithoutAServerCardKeepsTheCachedOnes } from "./copilot-dock-parts.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the dock's open-card merge (F4.339, plan R4)", () => {
  it("drops the cached commit card when a discovery card arrives", aDiscoveryCardDropsTheCachedCommitCard);
  it("keeps cached cards when no server-made card arrives", aTurnWithoutAServerCardKeepsTheCachedOnes);
});
