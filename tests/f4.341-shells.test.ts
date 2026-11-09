import { describe, expect, it } from "vitest";

import { SHELL_OF_DESIGN } from "../apps/web/src/lib/design";
import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";

/**
 * `F4.341` PR 5 (ADR 0118 decision 6, Amendment 1 A1) — `SHELL_OF_DESIGN` names a shell for every
 * design system of the contract and nothing else, and it is the ADR's table: `sidebar` for
 * `nexus-soft` and `enterprise-flat`, `topbar` for `swiss-grid` and `bento-ops`, `rail` for
 * `control-room-dark` (glass-showcase was dropped by A1).
 */
describe("F4.341 the shell of each design system", () => {
  it("SH5 SHELL_OF_DESIGN is total over the contract", () => {
    expect(Object.keys(SHELL_OF_DESIGN).sort()).toEqual([...DESIGN_SYSTEMS].sort());
  });

  it("SH5 SHELL_OF_DESIGN is ADR 0118 decision 6's table", () => {
    expect(SHELL_OF_DESIGN).toEqual({
      "nexus-soft": "sidebar",
      "enterprise-flat": "sidebar",
      "swiss-grid": "topbar",
      "bento-ops": "topbar",
      "control-room-dark": "rail",
    });
  });
});
