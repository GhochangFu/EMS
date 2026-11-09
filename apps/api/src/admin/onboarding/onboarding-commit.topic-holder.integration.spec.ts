import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import { topicHolderMessage } from "./onboarding-commit-values";

/**
 * `F4.339` / ADR 0117 decision 8 (plan T5.4, R8) — the commit names a same-organization RTU that
 * holds a draft RTU's MQTT topic, before any insert; a released topic commits; a holder in another
 * organization still meets the index and its fixed text, naming no code. Assertions here
 * (ADR 0014); the sibling `.test.ts` owns the database lifecycle.
 */
export type TopicHolderCtx = {
  /** The same-organization holder's code, and the draft RTU's code. */
  holderCode: string;
  draftCode: string;
  otherHolderCode: string;
  sameOrg?: unknown;
  released?: { locationId: string } | unknown;
  otherOrg?: unknown;
};

const INDEX_TEXT = "An MQTT topic in this draft is already taken. Choose a different topic.";

function messageOf(error: unknown): string {
  expect(error).toBeInstanceOf(BadRequestException);
  return JSON.stringify((error as BadRequestException).getResponse());
}

/** TH1 — a same-organization active holder: 400 naming both codes and "(active)". */
export function assertASameOrganizationHolderIsNamed(ctx: TopicHolderCtx): void {
  expect(messageOf(ctx.sameOrg)).toContain(topicHolderMessage(ctx.draftCode, ctx.holderCode, true));
}

/** TH2 — the same holder deactivated (topic released): the commit succeeds. */
export function assertAReleasedTopicCommits(ctx: TopicHolderCtx): void {
  expect(ctx.released).toBeDefined();
  expect(ctx.released instanceof Error, `the commit after release failed: ${String(ctx.released)}`).toBe(false);
}

/** TH3 — a holder in another organization: the index's fixed text, and no code of that row. */
export function assertAnotherOrganizationsHolderKeepsTheFixedText(ctx: TopicHolderCtx): void {
  const text = messageOf(ctx.otherOrg);
  expect(text).toContain(INDEX_TEXT);
  expect(text).not.toContain(ctx.otherHolderCode);
}
