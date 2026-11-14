import { describe, it } from "vitest";

import {
  aConversationWithNoZoneAsksForOne,
  aSummerOffsetIsTheSummerOne,
  aTurnTellsTheModelTheTimeAndZone,
  aWestZoneKeepsItsOwnDate,
  theLineGivesTheTimeInTheZone,
  utcIsItsOwnZone,
} from "./copilot-clock-message.spec";

/** `F4.360` defect 1 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.360 — the Copilot turn knows the time and the zone", () => {
  it("gives the time in UTC and in the zone, with the ISO form to write", () => theLineGivesTheTimeInTheZone());
  it("treats UTC as a zone with offset zero", () => utcIsItsOwnZone());
  it("keeps a west zone's own date and negative offset", () => aWestZoneKeepsItsOwnDate());
  it("takes the summer offset in summer", () => aSummerOffsetIsTheSummerOne());
  it("asks for a zone in a conversation with none of its own", () => aConversationWithNoZoneAsksForOne());
  it("sends the line on a turn, from the clock and the usage zone", () => aTurnTellsTheModelTheTimeAndZone());
});
