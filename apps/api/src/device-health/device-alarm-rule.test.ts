import { describe, it } from "vitest";

import * as spec from "./device-alarm-rule.spec";

/** `F3.89` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.89 — the ingest-host alarm's hold and text (ADR 0127 Amendment 2)", () => {
  it("holds the raise 120 s", () => spec.assertTheHoldIs120Seconds());
  it("is due only after 120 s of silence", () => spec.assertIngestHostDueWaitsForTheHold());
  it("is due at once for a rowless host", () => spec.assertARowlessHostIsDueAtOnce());
  it("is due when one of two hosts is stale past the hold", () => spec.assertOneStaleHostOfTwoIsDue());
  it("names the host, the sites and the RTUs", () => spec.assertTheTextNamesHostSitesAndRtus());
  it("uses singular forms", () => spec.assertSingularForms());
  it("caps each list at five names", () => spec.assertTheListsAreCapped());
  it("leaves out an RTU already Offline", () => spec.assertAnOfflineRtuIsLeftOut());
  it("counts edge-served RTUs, not unmonitored ones", () => spec.assertEdgeServedCountsAndNotMonitoredDoesNot());
  it("falls back to the code for a blank display name", () => spec.assertABlankDisplayNameFallsBackToTheCode());
  it("names only the stopped hosts", () => spec.assertOnlyTheStoppedHostsAreNamed());
  it("names a rowless host with no active RTUs", () => spec.assertARowlessHostIsNamedWithNoActiveRtus());
  it("reads 'no active RTUs' when none was reporting", () => spec.assertNoActiveRtusReadsSo());
  it("cuts long names and the whole text", () => spec.assertLongNamesAreCut());
  it("lists distinct site names", () => spec.assertSitesAreDistinctNames());
  it("is stable under row order", () => spec.assertTheTextIsStable());
});
