import { describe, it } from "vitest";

import {
  aDeletedStandalonePointIsNotRecreated,
  aTemplatedAssetStillCreatesItsMapping,
  anExistingStandalonePointGetsItsValue,
} from "./calc-write.standalone.spec";

/** `F4.311` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.311 — the calc write path on an asset with no template", () => {
  it("does not re-create a deleted standalone point's row, and drops its value", () =>
    aDeletedStandalonePointIsNotRecreated());
  it("writes the value of a standalone point whose row exists", () => anExistingStandalonePointGetsItsValue());
  it("keeps the lazy mapping create on a templated asset", () => aTemplatedAssetStillCreatesItsMapping());
});
