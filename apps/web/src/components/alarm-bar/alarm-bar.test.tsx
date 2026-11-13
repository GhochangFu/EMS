// @vitest-environment jsdom
import { describe, it } from "vitest";

import * as spec from "./alarm-bar.spec";

/** `F4.357` U5 — Vitest entry point. Assertions live in `alarm-bar.spec.tsx` (ADR 0014). */
describe("alarm bar (F4.357, ADR 0130 decisions 1–5)", () => {
  it("renders nothing without an installed feed", () => spec.rendersNothingWithoutAFeed());
  it("reads the page's scope: organization, location or none", () => spec.readsThePagesScope());
  it("shows one count per severity, rank descending", () => spec.showsTheCountsByRank());
  it("names the newest unacknowledged alarm, a device alarm by its RTU", () => spec.namesTheNewestUnacknowledgedAlarm());
  it("says no active alarms, and that a stale feed is not updating", () => spec.saysNoAlarmsAndNotUpdating());
  it("opens the scoped list upward and a row's details without navigating", () => spec.opensTheListAndTheDetails());
  it("offers Acknowledge to an operator and not to a viewer", () => spec.offersAcknowledgeToAnOperatorOnly());
  it("mutes, and offers to enable a blocked sound (U8)", () => spec.mutesAndOffersToEnableBlockedSound());
});
