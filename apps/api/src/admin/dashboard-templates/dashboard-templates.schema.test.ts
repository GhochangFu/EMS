import { describe, it } from "vitest";

import {
  acceptsAnInstantiateBodyWithANullAssetGroup,
  acceptsAPatchBodyWhoseWidgetCarriesNeitherKind,
  acceptsAPatchBodyWhoseWidgetCarriesOnlyARoleBinding,
  rejectsAPatchBodyWhoseChartWidgetCarriesAMetricSource,
  rejectsAPatchBodyWhoseWidgetCarriesBothKinds,
  stillRejectsAnInstantiateBodyWhoseAssetGroupIsNotAUuid,
} from "./dashboard-templates.schema.spec";

/** `F3.61` Task 2 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014). One `it()` per claim, so a failing claim reddens only its own
 * assertion. */
describe("F3.61 — the template PATCH body refuses a both-kinds widget and a mis-shaped source", () => {
  it("rejects a PATCH body whose one widget carries both kinds", () => {
    rejectsAPatchBodyWhoseWidgetCarriesBothKinds();
  });

  it("accepts a PATCH body whose widget carries only a role binding (the both-kinds case minus sources)", () => {
    acceptsAPatchBodyWhoseWidgetCarriesOnlyARoleBinding();
  });

  it("accepts a PATCH body whose widget carries neither kind", () => {
    acceptsAPatchBodyWhoseWidgetCarriesNeitherKind();
  });

  it("rejects a PATCH body whose one widget is a chart carrying a metric source (Amendment 1)", () => {
    rejectsAPatchBodyWhoseChartWidgetCarriesAMetricSource();
  });
});

/** `E4.2` U8b — the organization-wide instantiate arm at the request boundary
 * (ADR 0072 decision 1, an amendment to ADR 0049 decision 4). */
describe("E4.2 — the instantiate body takes a null asset group", () => {
  it("accepts a null assetGroupId", () => {
    acceptsAnInstantiateBodyWithANullAssetGroup();
  });

  it("still rejects an assetGroupId that is neither a uuid nor null", () => {
    stillRejectsAnInstantiateBodyWhoseAssetGroupIsNotAUuid();
  });
});
