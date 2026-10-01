import { describe, it } from "vitest";

import {
  emptyGrantKeepsNothing,
  emptyGroupIsAZeroStatus,
  groupGrantKeepsTheGrantedGroups,
  locationGrantKeepsTheGroupsAtReadableSites,
  anInfoAlarmWithNoOfflineKeepsInfo,
  noReadableMemberIsNullStatus,
  offlineBeatsAnInfoAlarm,
  offlineWithNoAlarmIsAWarning,
  unrestrictedKeepsEveryGroup,
  worstSeverityCarriesItsTone,
} from "./site-widgets.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.73 — SiteWidgetsService pure helpers", () => {
  it("an unrestricted reader keeps every candidate group", () => {
    unrestrictedKeepsEveryGroup();
  });

  it("an asset-group grant keeps the granted groups only", () => {
    groupGrantKeepsTheGrantedGroups();
  });

  it("a location grant keeps the groups at a readable site", () => {
    locationGrantKeepsTheGroupsAtReadableSites();
  });

  it("an empty grant keeps no group", () => {
    emptyGrantKeepsNothing();
  });

  it("a group with members, none readable, answers status null", () => {
    noReadableMemberIsNullStatus();
  });

  it("a group with no member answers a zero status", () => {
    emptyGroupIsAZeroStatus();
  });

  it("the worst severity carries its vocabulary tone", () => {
    worstSeverityCarriesItsTone();
  });

  it("offline members with no active alarm raise the tab to warning", () => {
    offlineWithNoAlarmIsAWarning();
  });

  it("offline members outrank an info alarm", () => {
    offlineBeatsAnInfoAlarm();
  });

  it("an info alarm with no member offline keeps info", () => {
    anInfoAlarmWithNoOfflineKeepsInfo();
  });
});
