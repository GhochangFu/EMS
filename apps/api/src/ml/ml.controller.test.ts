import { describe, it } from "vitest";

import {
  aBadRefIsA400BeforeTheScopeCheckOrTheService,
  theAnomalyListHandsReadableAssetIdsToTheServiceUnchanged,
  theAnomalyListNarrowsByTheParsedFilter,
  theListNarrowsByTheParsedFilter,
  theAnomalyRouteHandsTheIdAndWindowToTheService,
  theAnomalyRouteIsA403BeforeTheService,
  theAnomalyRouteRefusesABadWindowBeforeTheScopeCheck,
  theAnomalyRouteRefusesANonUuidIdFirst,
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
  it("the list hands narrow's value to the service unchanged (E1.9a)", () =>
    theListHandsReadableAssetIdsToTheServiceUnchanged());
  it("E1.4e past: a bad ref is a 400 first, before the query, canReadAsset or the service", () =>
    thePastRouteRefusesABadRefFirst());
  it("E1.4e past: a missing, garbled, reversed or over-long window, or an extra key, is a 400 before canReadAsset", () =>
    thePastRouteRefusesABadWindowBeforeTheScopeCheck());
  it("E1.4e past: a foreign asset is a 403 before the service", () => thePastRouteIsA403BeforeTheService());
  it("E1.4e past: the decoded pair, the window as instants and one clock reach the service", () =>
    thePastRouteHandsTheDecodedPairAndWindowToTheService());
});

describe("E1.2b — the anomaly routes (ADR 0135 Amendment 5 A-e, S1, S2, S4)", () => {
  it("a non-UUID asset id is a 400 first, before the query, canReadAsset or the service", () =>
    theAnomalyRouteRefusesANonUuidIdFirst());
  it("a bad window or an unknown key is a 400 before canReadAsset", () =>
    theAnomalyRouteRefusesABadWindowBeforeTheScopeCheck());
  it("a foreign asset is a 403 before the service", () => theAnomalyRouteIsA403BeforeTheService());
  it("the checked id, the window as instants and one clock reach the service", () =>
    theAnomalyRouteHandsTheIdAndWindowToTheService());
  it("the list hands narrow's value to the service unchanged; a bad since is a 400", () =>
    theAnomalyListHandsReadableAssetIdsToTheServiceUnchanged());
});

describe("E1.9a — the organization and location filter on the two lists (ADR 0135 Amendment 8 decision 8)", () => {
  it("the forecast list: narrow gets exactly the parsed keys; a bad query is a 400 and narrow never runs", () =>
    theListNarrowsByTheParsedFilter());
  it("the anomaly list: narrow gets the two keys, not since; a bad query is a 400 and narrow never runs", () =>
    theAnomalyListNarrowsByTheParsedFilter());
});
