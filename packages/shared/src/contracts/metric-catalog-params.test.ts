import { describe, it } from "vitest";

import {
  aBindingCarriesToneThroughTheWriteSchema,
  theCatalogHoldsTwelveKeysWithTheTwoNewMetrics,
  toneAcceptsCriticalAndOmittedOnly,
  toneIsDeclaredOnAlarmsActiveCountOnly,
} from "./metric-catalog-params.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.317 — the catalog keys and the tone param (ADR 0112 decision 9)", () => {
  it("holds twelve keys; sites.live.count and pue.ratio are metrics with no params", () => {
    theCatalogHoldsTwelveKeysWithTheTwoNewMetrics();
  });

  it("declares tone on alarms.active.count only", () => {
    toneIsDeclaredOnAlarmsActiveCountOnly();
  });

  it("accepts tone critical or omitted, refuses warning and an extra id", () => {
    toneAcceptsCriticalAndOmittedOnly();
  });

  it("carries tone through sourceBindingWriteSchema, refusing at params.tone", () => {
    aBindingCarriesToneThroughTheWriteSchema();
  });
});
