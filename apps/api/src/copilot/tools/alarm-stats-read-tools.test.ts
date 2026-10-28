import "reflect-metadata";

import { describe, it } from "vitest";

import * as spec from "./alarm-stats-read-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.291 PR 2 — list_alarms' severity and range, and get_alarm_stats", () => {
  it("list_alarms passes severity, raisedFrom and raisedTo; no filter passes none", spec.listAlarmsPassesTheSeverityAndRange);
  it("list_alarms resolves lastDays on the turn's clock", spec.listAlarmsResolvesLastDaysOnTheTurnClock);
  it("list_alarms refuses to before from before dispatch", spec.listAlarmsRefusesToBeforeFrom);
  it("list_alarms refuses lastDays with from before dispatch", spec.listAlarmsRefusesLastDaysWithFrom);
  it("list_alarms refuses a range off the turn's clock before any read", spec.listAlarmsRefusesARangeOffTheClock);
  it("get_alarm_stats reads each organization's readable ids, and none for an empty one", spec.alarmStatsReadsEachOrganizationsReadableIds);
  it("get_alarm_stats with locationId reads the subtree's readable ids", spec.alarmStatsReadsTheSubtreeOfALocation);
  it("get_alarm_stats resolves lastDays on the turn's clock", spec.alarmStatsResolvesLastDaysOnTheTurnClock);
  it("get_alarm_stats refuses a range over 31 days before any read", spec.alarmStatsRefusesARangeOver31Days);
  it("get_alarm_stats requires a range", spec.alarmStatsRequiresARange);
  it("get_alarm_stats reads one organization per call; nextCursor reaches the next", spec.alarmStatsReadsOneOrganizationPerCall);
  it("get_alarm_stats strips a key the contract does not name", spec.alarmStatsStripsAKeyTheContractDoesNotName);
  it("get_alarm_stats fails on an answer that breaks the contract", spec.alarmStatsThrowsOnABadAnswer);
  it("get_alarm_stats: one organization with 25 locations and 10 assets fits one result", spec.alarmStatsOneOrganizationFitsOneResult);
});
