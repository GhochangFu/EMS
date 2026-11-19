// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import { cleanupPolling, theSitePagePollsTheSiteListAtSixtySeconds } from "./site-page-polling.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.390 the site page's site-list poll", () => {
  afterEach(() => {
    cleanupPolling();
  });

  it("P1 polls the site list at 60 s and hands the read its abort signal", async () => {
    await theSitePagePollsTheSiteListAtSixtySeconds();
  });
});
