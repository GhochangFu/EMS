import { expect, vi } from "vitest";

import { fetchEscalationProfiles } from "./escalation";

/**
 * `F4.204` — the `failure()` helper in `escalation.ts` reads the error envelope
 * through the shared `apiErrorMessage`, so an array `message` (a Zod
 * validation refusal) reads as a sentence and not as raw JSON. Node
 * environment; `fetch` is stubbed, so nothing reaches the real API.
 * `fetchEscalationProfiles` stands for every caller, since all of them throw `failure()`.
 */

async function messageFor(status: number, body: string): Promise<string> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
  const error = await fetchEscalationProfiles().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  return (error as Error).message;
}

export async function arrayMessageJoinsIntoOneSentence(): Promise<void> {
  const body =
    '{"statusCode":400,"message":["code must be lowercase","name is required"],"error":"Bad Request"}';
  expect(await messageFor(400, body)).toBe("code must be lowercase name is required");
}

export async function stringMessageReadsAsThatSentence(): Promise<void> {
  const body = '{"statusCode":409,"message":"The code is already in use","error":"Conflict"}';
  expect(await messageFor(409, body)).toBe("The code is already in use");
}

export async function emptyBodyFallsBackToTheLabelAndStatus(): Promise<void> {
  expect(await messageFor(503, "")).toBe("escalation-profiles 503");
}

export async function nonJsonBodyPassesThroughUnchanged(): Promise<void> {
  expect(await messageFor(502, "<html>Bad gateway</html>")).toBe("<html>Bad gateway</html>");
}
