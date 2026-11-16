import { describe, it } from "vitest";

import {
  aBadRefIsA400BeforeTheScopeCheckOrTheService,
  aForeignAssetIsA403BeforeTheService,
  theListHandsReadableAssetIdsToTheServiceUnchanged,
  theServiceReceivesTheDecodedPairAndOneClock,
} from "./ml.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4a — the ml routes (ADR 0135 Amendment 3 R-c, S2)", () => {
  it("a malformed ref, a non-UUID id or an out-of-bounds key is a 400 before canReadAsset or the service", () =>
    aBadRefIsA400BeforeTheScopeCheckOrTheService());
  it("a foreign asset is a 403 before the service", () => aForeignAssetIsA403BeforeTheService());
  it("the service receives the decoded pair and one clock", () => theServiceReceivesTheDecodedPairAndOneClock());
  it("the list hands readableAssetIds' value to the service unchanged", () =>
    theListHandsReadableAssetIdsToTheServiceUnchanged());
});
