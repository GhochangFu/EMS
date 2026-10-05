import { expect, vi } from "vitest";

import { fetchNotificationChannels } from "./notifications";

/**
 * `F4.204` — the `failure()` helper in `notifications.ts` reads the error envelope
 * through the shared `apiErrorMessage`, so an array `message` (a Zod
 * validation refusal) reads as a sentence and not as raw JSON. Node
 * environment; `fetch` is stubbed, so nothing reaches the real API.
 * `fetchNotificationChannels` stands for every caller, since all of them throw `failure()`.
 */

async function messageFor(status: number, body: string): Promise<string> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
  const error = await fetchNotificationChannels().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  return (error as Error).message;
}

/** A validation refusal whose `message` is an array reads as one joined sentence. This is the only one of the four cases that is red on a revert to the old `failure()`. */
export async function arrayMessageJoinsIntoOneSentence(): Promise<void> {
  const body =
    '{"statusCode":400,"message":["code must be lowercase","name is required"],"error":"Bad Request"}';
  expect(await messageFor(400, body)).toBe("code must be lowercase name is required");
}

/** A refusal whose `message` is a string reads as that sentence. Pins behaviour the old parser already had, so it stays green on a revert. */
export async function stringMessageReadsAsThatSentence(): Promise<void> {
  const body = '{"statusCode":409,"message":"The code is already in use","error":"Conflict"}';
  expect(await messageFor(409, body)).toBe("The code is already in use");
}

/** An empty response body falls back to the label and status. Pins behaviour the old parser already had, so it stays green on a revert. */
export async function emptyBodyFallsBackToTheLabelAndStatus(): Promise<void> {
  expect(await messageFor(503, "")).toBe("notification-channels 503");
}

/** A non-JSON body passes through unchanged. Pins behaviour the old parser already had, so it stays green on a revert. */
export async function nonJsonBodyPassesThroughUnchanged(): Promise<void> {
  expect(await messageFor(502, "<html>Bad gateway</html>")).toBe("<html>Bad gateway</html>");
}
