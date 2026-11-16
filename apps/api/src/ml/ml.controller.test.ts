import { describe, it } from "vitest";

import {
  aBadRefIsA400BeforeTheScopeCheckOrTheService,
  aForeignAssetIsA403BeforeTheService,
  theListHandsReadableAssetIdsToTheServiceUnchanged,
  thePastRouteHandsTheDecodedPairAndWindowToTheService,
  thePastRouteIsA403BeforeTheService,
  thePastRouteRefusesABadRefFirst,
  thePastRouteRefusesABadWindowBeforeTheScopeCheck,
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
  it("E1.4e past: a bad ref is a 400 first, before the query, canReadAsset or the service", () =>
    thePastRouteRefusesABadRefFirst());
  it("E1.4e past: a missing, garbled, reversed or over-long window, or an extra key, is a 400 before canReadAsset", () =>
    thePastRouteRefusesABadWindowBeforeTheScopeCheck());
  it("E1.4e past: a foreign asset is a 403 before the service", () => thePastRouteIsA403BeforeTheService());
  it("E1.4e past: the decoded pair, the window as instants and one clock reach the service", () =>
    thePastRouteHandsTheDecodedPairAndWindowToTheService());
});
