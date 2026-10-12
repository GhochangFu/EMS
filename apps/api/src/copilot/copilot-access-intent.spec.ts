import { expect } from "vitest";

import { accessIntentOf } from "./copilot-access-intent";

/**
 * `F3.86` PR 4, ruling Q3 — the access-word test on the user's own message.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */
export const ASKS = [
  "grant Priya access to RSMOC-WC",
  "Revoke Sam's grant on the LV boards group",
  "make bob@x.io an organization admin",
  "create a viewer account for priya@example.com",
  "Deactivate the user Mallory",
] as const;

export const DOES_NOT_ASK = [
  "rename the asset Pump 2",
  "create a dashboard for the chiller plant",
  "what is the kW on RSMOC-GP now?",
  "add an RTU at CSMOC Gauteng",
  "accessory pumps and granted assets", // whole words only: "accessory" and "granted" are not access words
] as const;

export function assertTheAccessWordsAsk(): void {
  for (const message of ASKS) expect(accessIntentOf(message), message).toBe(true);
}

export function assertOtherMessagesDoNotAsk(): void {
  for (const message of DOES_NOT_ASK) expect(accessIntentOf(message), message).toBe(false);
}
