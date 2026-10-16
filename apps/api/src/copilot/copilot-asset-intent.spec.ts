import { expect } from "vitest";

import { assetIntentOf } from "./copilot-asset-intent";

/**
 * `F3.87` PR 7, plan D8 — the asset-word test on the user's own message.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */
export const ASKS = [
  "add the assets you see",
  "Create the pumps in this drawing",
  "register the meters as points",
  "make an asset for each tank",
] as const;

export const DOES_NOT_ASK = [
  "draw the mimic",
  "what does this drawing show?",
  "pointless addition of addresses", // whole words only
  "make the layout from this photo",
] as const;

export function assertTheAssetWordsAsk(): void {
  for (const message of ASKS) expect(assetIntentOf(message), message).toBe(true);
}

export function assertOtherMessagesDoNotAsk(): void {
  for (const message of DOES_NOT_ASK) expect(assetIntentOf(message), message).toBe(false);
}
