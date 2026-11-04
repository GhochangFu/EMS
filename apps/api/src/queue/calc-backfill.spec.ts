import { expect } from "vitest";

import { calcBackfillJobId, calcBackfillQueue } from "./calc-backfill";
import { JOB_ID_PATTERN, parsePayload, QueuePayloadError } from "./queue-registry";
import { ALL_QUEUES } from "./queues";

/**
 * `F4.311` PR 5a (ADR 0109 decision 7) — the `calc-backfill` declaration: a
 * tenant payload of three ids, refused field by field.
 */

export const VALID_PAYLOAD = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  assetPointId: "33333333-3333-4333-8333-333333333333",
};

function refusalReason(payload: unknown): string | undefined {
  try {
    parsePayload(calcBackfillQueue, payload);
  } catch (err) {
    return err instanceof QueuePayloadError ? err.reason : "not a QueuePayloadError";
  }
  return undefined;
}

export function aValidPayloadParses(): void {
  expect(parsePayload(calcBackfillQueue, VALID_PAYLOAD)).toEqual(VALID_PAYLOAD);
}

export function aPayloadWithoutOrganizationIsRefused(): void {
  const { organizationId: _o, ...rest } = VALID_PAYLOAD;
  expect(refusalReason(rest)).toBe("invalid_payload");
}

export function anExtraKeyIsRefused(): void {
  expect(refusalReason({ ...VALID_PAYLOAD, formula: "{a} * 2" })).toBe("invalid_payload");
}

export function theQueueIsTenant(): void {
  expect(calcBackfillQueue.tenancy).toBe("tenant");
}

export function theJobIdMatchesTheGrammar(): void {
  expect(JOB_ID_PATTERN.test(calcBackfillJobId(VALID_PAYLOAD.runId))).toBe(true);
}

export function allQueuesListsTheDeclaration(): void {
  expect((ALL_QUEUES as readonly unknown[]).includes(calcBackfillQueue)).toBe(true);
}
