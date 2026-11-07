// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aGeneratedViewOffersNoReplace,
  aMasterDataAdminSeesReplaceOnACopy,
  anOperatorSeesNoReplace,
  cleanupSitePageReplace,
} from "./site-page-replace.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.320 PR 2 the site page's Replace with this version", () => {
  afterEach(() => {
    cleanupSitePageReplace();
  });

  it("P1 shows the button to a master-data admin on a template copy", async () => {
    await aMasterDataAdminSeesReplaceOnACopy();
  }, 20_000);

  it("P2 shows no button to an operator and reads no preview", async () => {
    await anOperatorSeesNoReplace();
  });

  it("P3 offers no Replace on a generated view", async () => {
    await aGeneratedViewOffersNoReplace();
  });
});
