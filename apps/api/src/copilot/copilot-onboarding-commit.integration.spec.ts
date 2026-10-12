import type pg from "pg";
import { expect } from "vitest";

import type { CopilotPendingChangeDto, JwtPayload, OnboardingChatResponseDto, OnboardingCommitResponseDto } from "@bms/shared";

import { draftHash } from "../admin/onboarding/onboarding-commit-proposal";
import { PROPOSED_DRAFT_CHANGED, type OnboardingCommitService } from "../admin/onboarding/onboarding-commit.service";
import type { NewPendingChange } from "./copilot-pending-changes.service";
import { type CopilotOnboardingCommitReader, onboardingCommitCards } from "./copilot-onboarding-commit";

/**
 * `F3.86` PR 6 / ADR 0099 decision 7 (plan §8.2, §12 "Onboarding commit
 * refused after a draft change") — on a real database: the server-made card
 * reads the proposal the onboarding stored on the session's draft (as
 * `bms_tenant`, under the organization), its body is `{ draftHash }`, and the
 * Confirm's commit (`commitProposed` — the route the card's request reaches)
 * refuses a draft changed after the proposal with `PROPOSED_DRAFT_CHANGED`
 * and writes no location. The positive control commits the unchanged draft.
 * Assertions here; the `.test` sibling owns the database (ADR 0014).
 */
export interface CommitCardCtx {
  readonly ownerPool: pg.Pool;
  readonly reader: CopilotOnboardingCommitReader;
  readonly commitSvc: OnboardingCommitService;
  readonly jwt: JwtPayload;
  readonly organizationId: string;
  /** A session whose draft holds a stored commit proposal; `.test` seeds two. */
  readonly changedSessionId: string;
  readonly keptSessionId: string;
  readonly locationCodeOf: (sessionId: string) => string;
  readonly committed: { kept?: OnboardingCommitResponseDto; changed?: OnboardingCommitResponseDto };
}

/** The draft row as stored (owner read: the fixture's own view, not the code under test). */
async function storedDraft(ctx: CommitCardCtx, sessionId: string): Promise<Record<string, unknown>> {
  const { rows } = await ctx.ownerPool.query<{ draft: Record<string, unknown> }>(
    "SELECT draft FROM bms.onboarding_sessions WHERE id = $1",
    [sessionId],
  );
  if (!rows[0]) throw new Error(`F3.86: no session ${sessionId}`);
  return rows[0].draft;
}

/** The card the server makes after a turn that stored this session's draft (a fake store records it). */
async function cardFor(ctx: CommitCardCtx, sessionId: string): Promise<NewPendingChange> {
  const draft = await storedDraft(ctx, sessionId);
  const recorded: NewPendingChange[] = [];
  const pending = {
    listOpen: async (): Promise<CopilotPendingChangeDto[]> => [],
    discard: async () => undefined,
    propose: async (_userId: string, change: NewPendingChange) => {
      recorded.push(change);
      return null;
    },
  };
  const answer = {
    assistantMessage: "Ready to commit.",
    session: { id: sessionId, status: "draft", draft, draftHash: draftHash(draft), organizationName: "Org", messages: [] },
  } as unknown as OnboardingChatResponseDto;
  await onboardingCommitCards(
    { reader: ctx.reader, pending },
    { userId: ctx.jwt.sub, conversationId: "c", organizationId: ctx.organizationId, sessionId, answer, wrote: true },
  );
  expect(recorded, "the reader found the stored proposal and the card was made").toHaveLength(1);
  return recorded[0]!;
}

async function locationCount(ctx: CommitCardCtx, sessionId: string): Promise<number> {
  const { rows } = await ctx.ownerPool.query<{ n: string }>("SELECT count(*)::text AS n FROM bms.locations WHERE code = $1", [
    ctx.locationCodeOf(sessionId),
  ]);
  return Number(rows[0]?.n ?? "0");
}

/**
 * The draft changes after the proposal (`PATCH :id/draft`, as the page's
 * second tab would send it: a new location name, and the proposal cleared as
 * `mergeDraft` clears it). The card's Confirm then answers 400 with the
 * route's sentence, and no location row exists.
 */
export async function aDraftChangedAfterTheProposalRefusesTheCard(ctx: CommitCardCtx): Promise<void> {
  const card = await cardFor(ctx, ctx.changedSessionId);
  expect(card.body).toEqual({ draftHash: draftHash(await storedDraft(ctx, ctx.changedSessionId)) });

  await ctx.ownerPool.query(
    `UPDATE bms.onboarding_sessions
        SET draft = jsonb_set(draft - '_commitProposal', '{location,name}', '"Renamed by a second tab"')
      WHERE id = $1`,
    [ctx.changedSessionId],
  );

  const refused = await ctx.commitSvc
    .commitProposed(ctx.jwt, ctx.changedSessionId, card.body.draftHash as string)
    .then(
      (result) => {
        // A commit that should have been refused: kept so `afterAll` removes what it wrote.
        ctx.committed.changed = result;
        return null;
      },
      (err: { getStatus?: () => number; message?: string }) => err,
    );
  expect({ status: refused?.getStatus?.(), message: refused?.message }).toEqual({ status: 400, message: PROPOSED_DRAFT_CHANGED });
  expect(await locationCount(ctx, ctx.changedSessionId), "no location was written").toBe(0);
}

/** The positive control: the same card on an unchanged draft commits, and the location exists. */
export async function anUnchangedDraftCommitsThroughTheCard(ctx: CommitCardCtx): Promise<void> {
  const card = await cardFor(ctx, ctx.keptSessionId);
  ctx.committed.kept = await ctx.commitSvc.commitProposed(ctx.jwt, ctx.keptSessionId, card.body.draftHash as string);
  expect(await locationCount(ctx, ctx.keptSessionId)).toBe(1);
}
