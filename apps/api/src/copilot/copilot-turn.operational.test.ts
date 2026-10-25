import { describe, it } from "vitest";

import {
  aCloseWordOffersNoAckTool,
  anAckWordOffersNoCloseTool,
  aFollowUpOffersNoAckTool,
  anAlarmTextCannotAskForAnAck,
  aTurnThatAsksOffersTheAckTool,
  aTurnThatDoesNotAskOffersNeither,
} from "./copilot-turn.operational.spec";

/** `F4.284` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.284 — the own-message gate for an acknowledge and a close (ADR 0106 decision 3)", () => {
  it("offers the ack tool when the message asks", () => aTurnThatAsksOffersTheAckTool());
  it("offers neither tool when the message does not ask", () => aTurnThatDoesNotAskOffersNeither());
  it("offers no ack tool on a follow-up", () => aFollowUpOffersNoAckTool());
  it("refuses an ack an alarm's own text asks for", () => anAlarmTextCannotAskForAnAck());
  it("offers the close tool, not the ack tool, for a close word", () => aCloseWordOffersNoAckTool());
  it("offers the ack tool, not the close tool, for an ack word", () => anAckWordOffersNoCloseTool());
});
