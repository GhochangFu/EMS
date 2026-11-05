import { describe, it } from "vitest";

import { thePackageRootExportsTheSeedLiteral } from "./point-key-states-seed.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.309 — @bms/db exports POINT_KEY_STATE_SEED", () => {
  it("exports the seed's own literal, and not the seed function", () => thePackageRootExportsTheSeedLiteral());
});
