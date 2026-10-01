// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  anUnreadableTabReadsOutsideScopeNeverAZero,
  oneAlarmReadsOneAlarm,
  theDotIsAriaHidden,
  twoAlarmsReadTwoAlarms,
} from "./tab-status-marker.spec";

/**
 * `F3.77` — Vitest entry point for the tab status marker; assertions live in the sibling `.spec`
 * (ADR 0014), one claim per `it()`.
 */
describe("F3.77 tab status marker", () => {
  afterEach(() => {
    cleanup();
  });

  it('two alarms read "2 alarms"', () => {
    twoAlarmsReadTwoAlarms();
  });

  it('one alarm reads "1 alarm"', () => {
    oneAlarmReadsOneAlarm();
  });

  it('an unreadable tab reads "Outside scope", never a zero', () => {
    anUnreadableTabReadsOutsideScopeNeverAZero();
  });

  it("the dot is aria-hidden", () => {
    theDotIsAriaHidden();
  });
});
