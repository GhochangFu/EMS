import "reflect-metadata";

import { describe, it } from "vitest";

import {
  assertAlarmDetailsBoundsTheAffectedAssets,
  assertAlarmDetailsBoundsTheText,
  assertAlarmDetailsLetsAnyOtherFailureThrough,
  assertAlarmDetailsNeverOffersAWrite,
  assertAlarmDetailsReadsOnceOverTheUnion,
  assertAlarmDetailsRefusesAMisplacedOrganization,
  assertAlarmDetailsRefusesAnAlarmOutsideTheScope,
  assertAlarmDetailsSchemaRefusesBeforeDispatch,
  assertAlarmDetailsWithNoReadableAssetMakesNoRead,
  assertAlarmKbBoundsTheResult,
  assertAlarmKbCutsAnOversizedEntry,
  assertAlarmKbEntriesModeFilters,
  assertAlarmKbIndexModeListsTheCodes,
  assertAlarmKbNarrowsToTheReadableOrganizations,
  assertAlarmKbNeverOffersAWrite,
  assertAlarmKbReadsOnceWithTheAllowedSet,
  assertAlarmKbRefusesAClassFromAnotherOrganization,
  assertTheTurnExplainsAnAlarm,
  assertTheTurnRefusesAnOwnKeyAlarm,
  assertTheTurnScrubsTheKbBodyAndTheDetails,
} from "./alarm-read-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.276 — the copilot's alarm details and alarm knowledge-base read tools", () => {
  it("get_alarm_details reads once over the union of readable assets, never null", assertAlarmDetailsReadsOnceOverTheUnion);
  it("get_alarm_details refuses an alarm outside the allowed organizations", assertAlarmDetailsRefusesAnAlarmOutsideTheScope);
  it("get_alarm_details with no readable asset refuses with no details read", assertAlarmDetailsWithNoReadableAssetMakesNoRead);
  it("get_alarm_details refuses an answer whose organization disagrees with the placement", assertAlarmDetailsRefusesAMisplacedOrganization);
  it("get_alarm_details lets a failure other than not-found through", assertAlarmDetailsLetsAnyOtherFailureThrough);
  it("get_alarm_details' schema refuses a bad id and an unknown key before dispatch", assertAlarmDetailsSchemaRefusesBeforeDispatch);
  it("get_alarm_details strips extra keys and cuts the affected assets at 25", assertAlarmDetailsBoundsTheAffectedAssets);
  it("get_alarm_details cuts every text field so one result fits, the class philosophy kept", assertAlarmDetailsBoundsTheText);
  it("get_alarm_details never offers a write", assertAlarmDetailsNeverOffersAWrite);
  it("get_alarm_kb reads once with the allowed organization set, never null or []", assertAlarmKbReadsOnceWithTheAllowedSet);
  it("get_alarm_kb narrows to the caller's readable organizations; none readable makes no read", assertAlarmKbNarrowsToTheReadableOrganizations);
  it("get_alarm_kb refuses a class from an organization outside the read set", assertAlarmKbRefusesAClassFromAnotherOrganization);
  it("get_alarm_kb with no filter lists each class's alarm codes and no entry text", assertAlarmKbIndexModeListsTheCodes);
  it("get_alarm_kb filters entries by alarmCode, query and templateCode", assertAlarmKbEntriesModeFilters);
  it("get_alarm_kb bounds the result by count and by a character budget, as a prefix", assertAlarmKbBoundsTheResult);
  it("get_alarm_kb keeps one oversized entry with its text cut", assertAlarmKbCutsAnOversizedEntry);
  it("get_alarm_kb never offers a write", assertAlarmKbNeverOffersAWrite);
  it("a turn scrubs a secret in the KB body and in the alarm enrichment", assertTheTurnScrubsTheKbBodyAndTheDetails);
  it("a turn explains an alarm from its details, the KB and the recent readings", assertTheTurnExplainsAnAlarm);
  it("a turn refuses an alarm and a KB of an own-key organization", assertTheTurnRefusesAnOwnKeyAlarm);
});
