// @vitest-environment jsdom
import { describe, it } from "vitest";

import * as spec from "./alarm-bar-maintenance.spec";

/** `F4.359` U13 — Vitest entry point. Assertions live in `alarm-bar-maintenance.spec.tsx` (ADR 0014). */
describe("alarm bar maintenance pill (F4.359, ADR 0131 decisions 6, 15, 19)", () => {
  it("one active window: the pill reads the suppressed count, read in the page scope", () => spec.thePillShowsTheSuppressedCount());
  it("no active window: no pill, even with suppressed alarms", () => spec.noWindowNoPill());
  it("a window with nothing suppressed: Maintenance 0", () => spec.aWindowWithNothingSuppressedShowsZero());
  it("the pill never blinks and suppressed alarms sound nothing", () => spec.thePillNeverBlinksOrSounds());
  it("a click opens the windows; an admin gets the admin page", () => spec.aClickOpensTheWindows());
  it("All alarms drops suppressed rows and counts them (Q4)", () => spec.allAlarmsDropsSuppressedRows());
  it("no feed installed: the windows read is not issued", () => spec.noFeedNoWindowsRead());
});
