// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aFailedRefetchDropsTheData,
  aForbiddenReadIsUndefinedAndNotRetried,
  aNonUuidAsksNothing,
  oneReadForTheAsset,
  theListQueryFnIsAThunkHoldingTheFilter,
  theAssetQueryPolicy,
  theListQueryPolicy,
} from "./use-degradation.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
});

describe("E1.5b — the degradation hooks", () => {
  it("one read for the asset", () => oneReadForTheAsset());
  it("an id that is not a uuid asks nothing", () => aNonUuidAsksNothing());
  it("a 403 is undefined and not retried", () => aForbiddenReadIsUndefinedAndNotRetried());
  it("a failed refetch drops the data", () => aFailedRefetchDropsTheData());
  it("the list queryFn is a thunk holding the filter", () => theListQueryFnIsAThunkHoldingTheFilter());
  it("the list query policy", () => theListQueryPolicy());
  it("the asset query policy: kept 15 minutes, a 403 never asked again", () => theAssetQueryPolicy());
});
