import { describe, it } from "vitest";

import * as spec from "./template-lifecycle.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.246 — the template instantiate rule (ADR 0049 decision 2)", () => {
  it("lets a published version instantiate", () => spec.assertAPublishedVersionInstantiates());
  it("refuses a draft or an archived version", () => spec.assertADraftOrArchivedVersionDoesNotInstantiate());
  it("refuses a dashboard template with the dashboard route's sentence", () =>
    spec.assertTheDashboardRefusalIsTheDashboardRoutesSentence());
  it("refuses an asset template with the asset route's two sentences", () =>
    spec.assertTheAssetRefusalIsTheAssetRoutesTwoSentences());
});
