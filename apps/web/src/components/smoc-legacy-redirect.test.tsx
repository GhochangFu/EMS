// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedReadLandsOnTheControlRoom,
  aListWithoutTheSmocSiteLandsOnTheControlRoom,
  aPendingReadDoesNotNavigate,
  aPendingReadShowsAStatusLine,
  aReadableSmocSiteLandsOnItsTab,
  cleanupRedirect,
  noReadReachesTheNetwork,
} from "./smoc-legacy-redirect.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.70 U5a SmocLegacyRedirect", () => {
  afterEach(() => {
    cleanupRedirect();
  });

  it("R1 sends a caller who reads RSMOC-WC to that site's tab", async () => {
    await aReadableSmocSiteLandsOnItsTab();
  });

  it("R2 sends a caller who cannot read RSMOC-WC to /control-room", async () => {
    await aListWithoutTheSmocSiteLandsOnTheControlRoom();
  });

  it("R3a renders a status line while the read is pending", () => {
    aPendingReadShowsAStatusLine();
  });

  it("R3b does not navigate while the read is pending", async () => {
    await aPendingReadDoesNotNavigate();
  });

  it("R4 sends a caller whose read failed to /control-room", async () => {
    await aFailedReadLandsOnTheControlRoom();
  });

  it("R5 reaches no network", async () => {
    await noReadReachesTheNetwork();
  });
});
