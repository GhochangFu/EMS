import { describe, it } from "vitest";

import {
  AGGREGATE_FAULT_NAMES,
  aggregateFaultKeepsItsMessage,
  parsePointsListTrimsAndSplits,
  theExportAdmitsACustomRangeWithCompare,
  theExportAdmitsATrailingWindow,
  theExportBucketFunctionDefaultsToAvg,
  theExportRefusesAPointsFault,
  theExportRefusesARangeFaultWithTheSameMessage,
  theExportRefusesAnUnknownKey,
} from "./telemetry-queries.spec";

/** `F4.303` U2 — Vitest entry point. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.303 — aggregate range rules and the history export query", () => {
  AGGREGATE_FAULT_NAMES.forEach((name, index) => {
    it(`the aggregate read still refuses ${name} with the same issue`, () => aggregateFaultKeepsItsMessage(index));
    it(`the export refuses ${name} with the same issue`, () => theExportRefusesARangeFaultWithTheSameMessage(index));
  });
  it("the export admits a trailing window", () => theExportAdmitsATrailingWindow());
  it("the export admits a custom range with compare", () => theExportAdmitsACustomRangeWithCompare());
  it("the export bucket function defaults to avg", () => theExportBucketFunctionDefaultsToAvg());
  it("the export refuses an empty points list", () => theExportRefusesAPointsFault(" , "));
  it("the export refuses nine codes", () => theExportRefusesAPointsFault("a,b,c,d,e,f,g,h,i"));
  it("the export refuses a repeated code", () => theExportRefusesAPointsFault("kw,kw"));
  it("the export refuses a code with a space", () => theExportRefusesAPointsFault("kw,bad code"));
  it("the export refuses an unknown key", () => theExportRefusesAnUnknownKey());
  it("parsePointsList trims and splits", () => parsePointsListTrimsAndSplits());
});
