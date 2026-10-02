import { describe, it } from "vitest";

import {
  aCycleTerminates,
  anUnfedNodeIsDeEnergised,
  closedEnergisesEverySegment,
  fanOutAnyClosedIsEnergised,
  fanOutUnknownAndOpenIsUnknown,
  noMembersIsUnknown,
  noSourcesIsNull,
  openStopsAfterTheBreaker,
  parallelOpenAndClosedIsEnergised,
  parallelUnknownAndOpenIsUnknown,
  staleMemberIsUnknownAfter,
  trippedStopsAfterTheBreaker,
  worstAllClosedIsClosed,
  worstOpenBeatsUnknown,
  worstTrippedBeatsOpen,
  worstUnknownBeatsClosed,
  worstWithNoDownstreamSwitchIsNull,
} from "./mimic-energised.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.74 — energiseGraph (ADR 0088, plan D3)", () => {
  it("energises every segment through a closed breaker", () => {
    closedEnergisesEverySegment();
  });

  it("de-energises after an open breaker and not before it", () => {
    openStopsAfterTheBreaker();
  });

  it("de-energises after a tripped breaker", () => {
    trippedStopsAfterTheBreaker();
  });

  it("answers unknown after a stale breaker", () => {
    staleMemberIsUnknownAfter();
  });

  it("joins two breakers into one bus with OR: open and closed is energised", () => {
    parallelOpenAndClosedIsEnergised();
  });

  it("joins two breakers into one bus: unknown and open is unknown", () => {
    parallelUnknownAndOpenIsUnknown();
  });

  it("passes energy through a fan-out breaker with any closed member", () => {
    fanOutAnyClosedIsEnergised();
  });

  it("answers unknown for a fan-out breaker with an unknown member and none closed", () => {
    fanOutUnknownAndOpenIsUnknown();
  });

  it("answers unknown for a switching node with no members", () => {
    noMembersIsUnknown();
  });

  it("does not walk a graph with no source", () => {
    noSourcesIsNull();
  });

  it("de-energises a non-source node with no inbound pipe", () => {
    anUnfedNodeIsDeEnergised();
  });

  it("terminates on a graph with a cycle", () => {
    aCycleTerminates();
  });
});

describe("F3.74 — worstDownstreamSwitch (ADR 0088, plan D3, D6)", () => {
  it("ranks tripped above open", () => {
    worstTrippedBeatsOpen();
  });

  it("ranks open above unknown", () => {
    worstOpenBeatsUnknown();
  });

  it("ranks unknown above closed", () => {
    worstUnknownBeatsClosed();
  });

  it("answers closed when every member is closed", () => {
    worstAllClosedIsClosed();
  });

  it("answers null for a node with no direct downstream switch", () => {
    worstWithNoDownstreamSwitchIsNull();
  });
});
