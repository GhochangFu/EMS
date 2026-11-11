import { describe, it } from "vitest";

import {
  aBadCodeIsRefused,
  aBadPrefixIsRefused,
  aBodyNamingAnotherFieldIsRefused,
  aGoodPatchReachesTheService,
  theListAsksTheService,
} from "./asset-domains.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — AssetDomainsAdminController (the parse boundary)", () => {
  it("passes a well-formed PATCH to the service, null included", async () => {
    await aGoodPatchReachesTheService();
  });

  it("refuses a body that names any field but the prefix (strict)", async () => {
    await aBodyNamingAnotherFieldIsRefused();
  });

  it("answers 400 for a bad prefix or an empty body", async () => {
    await aBadPrefixIsRefused();
  });

  it("answers 400 for a bad code", async () => {
    await aBadCodeIsRefused();
  });

  it("serves the list through the service", async () => {
    await theListAsksTheService();
  });
});
