import { describe, it } from "vitest";

import {
  assertANewRtuGetsOneWindow,
  assertARecoveredHostGivesOneWindow,
  assertEachBandAtItsBoundary,
  assertNoMonitoredSinceIsNotMonitored,
  assertTheHostBoundary,
  assertTheHostSummary,
  assertTheReferenceIsTheHostBeat,
} from "./device-state.spec";

/** `F3.16` / ADR 0127 decisions 11 and 16 — `rtuStateAt`, `hostStateAt` and `hostSummaryFor`. */
describe("F3.16 — the device state rule", () => {
  it("D1 each band at its boundary", () => {
    assertEachBandAtItsBoundary();
  });
  it("D2 the reference is the host's last beat, not now", () => {
    assertTheReferenceIsTheHostBeat();
  });
  it("D3 a new RTU gets one window", () => {
    assertANewRtuGetsOneWindow();
  });
  it("D4 a recovered host gives one window", () => {
    assertARecoveredHostGivesOneWindow();
  });
  it("D5 no monitored_since is not_monitored", () => {
    assertNoMonitoredSinceIsNotMonitored();
  });
  it("D6 the host is stale after 30 s against the database clock", () => {
    assertTheHostBoundary();
  });
  it("D7 the host summary takes the serving hosts and the worst state", () => {
    assertTheHostSummary();
  });
});
