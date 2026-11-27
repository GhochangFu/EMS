// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aFailedReadIsNoAdvisories,
  aFailedRefetchDropsTheAdvisories,
  aNonUuidAsksNothing,
  oneReadForTheAsset,
} from "./use-asset-advisories.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
});

describe("E1.6b — useAssetAdvisories", () => {
  it("one read for the asset, re-read every 15 minutes until a 403", () => oneReadForTheAsset());
  it("an id that is not a uuid asks nothing", () => aNonUuidAsksNothing());
  it("a failed first read, settled, is no advisories", () => aFailedReadIsNoAdvisories());
  it("a failed refetch drops the advisories", () => aFailedRefetchDropsTheAdvisories());
});
