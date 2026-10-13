import { expect } from "vitest";

import type { OnboardingDraftListDto } from "@bms/shared";

/**
 * `F4.255` (ADR 0099 Amendment 2 A1) — `OnboardingService.listDrafts` against
 * real Postgres, as the real `bms_fleet` role. The unit spec renders the join
 * and the projection; only a database proves the rows they select. The sibling
 * `.test.ts` seeds two fresh organizations: in A two drafts (the newer one
 * inserted first, and stamped `created_by` a seeded user) and one committed
 * session, in B one draft; it lists A as the global administrator once.
 * Assertions live here (ADR 0014).
 */

export type ListDraftsCtx = {
  list: OnboardingDraftListDto;
  /** A's draft stamped `created_by`, updated last. */
  newerDraft: string;
  /** A's draft with no starter, updated first. */
  olderDraft: string;
  newerLocationName: string;
  olderLocationName: string;
  starter: { id: string; displayName: string };
};

/** Exactly A's two drafts, newest update first: not A's committed session, not B's draft. */
export function theListHoldsTheOrganizationsDraftsNewestFirst(ctx: ListDraftsCtx): void {
  expect(ctx.list.items.map((item) => item.id)).toEqual([ctx.newerDraft, ctx.olderDraft]);
}

/** Each location name is read out of the draft JSON. */
export function eachLocationNameComesFromTheDraft(ctx: ListDraftsCtx): void {
  expect(ctx.list.items.map((item) => item.locationName)).toEqual([ctx.newerLocationName, ctx.olderLocationName]);
}

/** The stamped draft names its starter from `users`; the unstamped one names none. */
export function theStarterIsJoinedFromUsers(ctx: ListDraftsCtx): void {
  expect(ctx.list.items.map((item) => item.createdBy)).toEqual([ctx.starter, null]);
}

/** No item carries the draft (it holds `_secrets`); the adjacent positive: each carries the summary keys. */
export function noItemCarriesTheDraft(ctx: ListDraftsCtx): void {
  expect(ctx.list.items.map((item) => Object.keys(item).sort())).toEqual([
    ["createdAt", "createdBy", "currentPhase", "id", "locationName", "organizationId", "updatedAt"],
    ["createdAt", "createdBy", "currentPhase", "id", "locationName", "organizationId", "updatedAt"],
  ]);
}
