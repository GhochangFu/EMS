import { expect } from "vitest";

import type { CopilotMessageDto } from "@bms/shared";
import { isCopilotOutcomeLine } from "@bms/shared/copilot";

import { awaitingFollowUp } from "./copilot-awaiting-follow-up";
import type { LatestFinishedChange } from "./copilot-pending-changes.service";
import { changeOutcomeLine } from "./copilot-turn.service";

/**
 * `F4.244` — `awaitingFollowUp`, the pure half of the detail's
 * `awaitingFollowUp` field. The real clocks are composed in
 * `copilot-pending-changes.integration.spec.ts` (`theRealTimestampsCompose`).
 * Vitest entry point: the sibling `.test.ts`.
 */

const FINISHED_AT = Date.parse("2026-10-21T10:00:00.000Z");

const LATEST: LatestFinishedChange = {
  id: "44444444-4444-4444-8444-444444444444",
  status: "applied",
  resultStatus: 200,
  summary: 'Publish the dashboard template "Feeder".',
  finishedAtMs: FINISHED_AT,
  ageMs: 1_200,
};

function line(role: CopilotMessageDto["role"], content: string, createdAt: string): CopilotMessageDto {
  return { id: `m-${createdAt}`, conversationId: "c", role, content, organizationIds: [], createdAt };
}

const BEFORE = "2026-10-21T09:59:59.000Z";
const AFTER = "2026-10-21T10:00:01.000Z";
const APPLIED_LINE = `Applied: ${LATEST.summary}`;

export function noFinishedChangeIsNoWait(): void {
  expect(awaitingFollowUp(null, [])).toBeNull();
}

/** A finished change with no outcome line yet is awaited: exactly the three DTO keys. */
export function aChangeWithNoLineIsAwaited(): void {
  expect(awaitingFollowUp(LATEST, [line("user", "publish Feeder", BEFORE)])).toEqual({
    changeId: LATEST.id,
    status: "applied",
    ageMs: 1_200,
  });
}

export function itsOutcomeLineAfterItFinishedEndsTheWait(): void {
  expect(awaitingFollowUp(LATEST, [line("action", APPLIED_LINE, AFTER)])).toBeNull();
}

/** A line stored in the same millisecond the change finished ends the wait (the `>=`). */
export function aLineInTheSameMillisecondEndsTheWait(): void {
  expect(awaitingFollowUp(LATEST, [line("action", APPLIED_LINE, "2026-10-21T10:00:00.000Z")])).toBeNull();
}

/** The same text stored before the change finished is an earlier change's line: the wait goes on. */
export function anOlderLineDoesNotEndTheWait(): void {
  expect(awaitingFollowUp(LATEST, [line("action", APPLIED_LINE, BEFORE)])).not.toBeNull();
}

/** A user's message that reads like an outcome is not one. */
export function aUserLineDoesNotEndTheWait(): void {
  expect(awaitingFollowUp(LATEST, [line("user", APPLIED_LINE, AFTER)])).not.toBeNull();
}

/**
 * Review C1: the follow-up of an earlier change A stores its line after the
 * newer change B finished. That line is not B's, so B is still awaited.
 */
export function anotherChangesLineDoesNotEndTheWait(): void {
  expect(awaitingFollowUp(LATEST, [line("action", "Applied: Archive the template \"Old\".", AFTER)])).not.toBeNull();
}

/** An unreadable `createdAt` never ends a wait (NaN compares false). */
export function anUnreadableTimeDoesNotEndTheWait(): void {
  expect(awaitingFollowUp(LATEST, [line("action", APPLIED_LINE, "not a time")])).not.toBeNull();
}

/** The producer binds the web's detector: both outcome shapes are outcome lines. */
export function theProducedAppliedLineIsAnOutcome(): void {
  expect(isCopilotOutcomeLine(changeOutcomeLine({ status: "applied", resultStatus: 201, summary: "x" }))).toBe(true);
}

export function theProducedFailedLineIsAnOutcome(): void {
  expect(isCopilotOutcomeLine(changeOutcomeLine({ status: "failed", resultStatus: 412, summary: "x" }))).toBe(true);
}
