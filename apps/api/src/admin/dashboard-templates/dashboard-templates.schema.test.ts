import { describe, it } from "vitest";

import {
  acceptsAPatchBodyWhoseWidgetCarriesNeitherKind,
  acceptsAPatchBodyWhoseWidgetCarriesOnlyARoleBinding,
  rejectsAPatchBodyWhoseChartWidgetCarriesAMetricSource,
  rejectsAPatchBodyWhoseWidgetCarriesBothKinds,
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
