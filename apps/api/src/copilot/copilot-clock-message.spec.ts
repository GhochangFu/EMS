import { expect } from "vitest";

import { FakeLlmProvider } from "../admin/onboarding/onboarding-agent-loop.spec";
import { copilotClockMessage } from "./copilot-clock-message";
import { GLOBAL_ADMIN, harness, turn } from "./copilot-turn.service.spec";

/**
 * `F4.360` defect 1 — the Copilot refused "until 08:25 IST today" at 08:11 IST
 * (AWS, 2026-11-14): the turn gave the model no clock and no zone, so it
 * guessed the date and its end failed "must end in the future". Each turn now
 * carries a system line with the time now, in UTC and in the zone the turn's
 * usage counter already uses (the conversation's organization, else the user's
 * home organization, else UTC). Vitest entry point: the sibling `.test.ts`.
 */

const AT_0811_IST = new Date("2026-11-14T02:41:00.000Z");

/** The line names the instant in UTC, the wall time and offset in the zone, and the ISO form to write. */
export function theLineGivesTheTimeInTheZone(): void {
  const line = copilotClockMessage(AT_0811_IST, "Asia/Kolkata");
  expect(line).toContain("2026-11-14T02:41:00Z");
  expect(line).toContain("Saturday 14 November 2026, 08:11 in Asia/Kolkata (UTC+05:30)");
  expect(line).toContain("2026-11-14T08:11:00+05:30");
}

/** UTC has offset zero and its own wall time. Mutation: hard-code +05:30 → red. */
export function utcIsItsOwnZone(): void {
  const line = copilotClockMessage(AT_0811_IST, "UTC");
  expect(line).toContain("Saturday 14 November 2026, 02:41 in UTC (UTC+00:00)");
  expect(line).toContain("2026-11-14T02:41:00+00:00");
}

/** A negative offset and a date that differs from UTC's. Mutation: take the date from UTC → red. */
export function aWestZoneKeepsItsOwnDate(): void {
  const line = copilotClockMessage(AT_0811_IST, "America/New_York");
  expect(line).toContain("Friday 13 November 2026, 21:41 in America/New_York (UTC-05:00)");
}

/**
 * The turn sends the line, from the service's clock and the usage step's zone,
 * after the fixed prompt and the scope line. Mutation: drop the message → red.
 */
export async function aTurnTellsTheModelTheTimeAndZone(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  const h = harness(llm, { usage: { ok: true, timeZone: "Asia/Kolkata" } });
  h.service.clock = () => AT_0811_IST;
  await turn(h, "end it at 08:25 IST today");
  const system = (llm.seen[0] ?? []).filter((m) => m.role === "system").map((m) => m.content);
  expect(system[2]).toBe(copilotClockMessage(AT_0811_IST, "Asia/Kolkata"));
}

/** Daylight saving: New York in July is UTC-04:00. Mutation: take the offset from a fixed winter date → red. */
export function aSummerOffsetIsTheSummerOne(): void {
  expect(copilotClockMessage(new Date("2026-07-14T12:00:00.000Z"), "America/New_York")).toContain(
    "Tuesday 14 July 2026, 08:00 in America/New_York (UTC-04:00)",
  );
}

/**
 * `F4.360` review: the global admin on every organization has no zone of its own — the line keeps UTC as a fact
 * and tells the model to ask, never to read a bare time in UTC. Mutation: always pass `hasOwnZone` → red.
 */
export async function aConversationWithNoZoneAsksForOne(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  const h = harness(llm, { conversationOrg: null });
  h.service.clock = () => AT_0811_IST;
  await turn(h, "end it at 08:25 today", GLOBAL_ADMIN);
  const system = (llm.seen[0] ?? []).filter((m) => m.role === "system").map((m) => m.content);
  expect(system[2]).toBe(copilotClockMessage(AT_0811_IST, "UTC", false));
  expect(system[2]).toContain("ask which zone they mean");
  expect(copilotClockMessage(AT_0811_IST, "UTC")).not.toContain("ask which zone");
}
