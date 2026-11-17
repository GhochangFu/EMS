import { and, eq, gte, lt, sum } from "drizzle-orm";

import { mlFindingParagraphs } from "@bms/db";
import type { MlFindingsKind } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 7 (plan §4.5, T3.4; owner ruling
 * Q3 (a)) — the paragraph cache's reads and its one write, each on the `tx` of
 * a `withTenant(organizationId)` the caller opened for **the card's**
 * organization. Drizzle builder calls only; this is the one file that names the
 * table. Row security scopes every statement; the organization predicate is
 * written as well.
 */

export type StoredParagraph = {
  readonly id: string;
  readonly status: "ok" | "rejected" | "failed";
  readonly paragraph: string | null;
  readonly reason: string | null;
  readonly attempts: number;
  readonly createdAt: Date;
};

export type ParagraphOutcome =
  | { readonly status: "ok"; readonly paragraph: string; readonly reason: null }
  | { readonly status: "rejected" | "failed"; readonly paragraph: null; readonly reason: string };

/** 00:00 UTC of `now`'s day: the daily cap's window. */
export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Whether two instants fall on the same UTC day. */
export const sameUtcDay = (a: Date, b: Date): boolean => startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();

const isStatus = (value: string): value is StoredParagraph["status"] =>
  value === "ok" || value === "rejected" || value === "failed";

/** The row of one key, or `null`. */
export async function readParagraph(
  tx: BmsTx,
  organizationId: string,
  kind: MlFindingsKind,
  factsHash: string,
): Promise<StoredParagraph | null> {
  const [row] = await tx
    .select({
      id: mlFindingParagraphs.id,
      status: mlFindingParagraphs.status,
      paragraph: mlFindingParagraphs.paragraph,
      reason: mlFindingParagraphs.reason,
      attempts: mlFindingParagraphs.attempts,
      createdAt: mlFindingParagraphs.createdAt,
    })
    .from(mlFindingParagraphs)
    .where(
      and(
        eq(mlFindingParagraphs.organizationId, organizationId),
        eq(mlFindingParagraphs.kind, kind),
        eq(mlFindingParagraphs.factsHash, factsHash),
      ),
    )
    .limit(1);
  if (!row || !isStatus(row.status)) return null;
  return { ...row, status: row.status };
}

/** Owner ruling Q3 (a): the provider calls of the organization's rows created since 00:00 UTC — `sum(attempts)`. */
export async function attemptsToday(tx: BmsTx, organizationId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ total: sum(mlFindingParagraphs.attempts) })
    .from(mlFindingParagraphs)
    .where(and(eq(mlFindingParagraphs.organizationId, organizationId), gte(mlFindingParagraphs.createdAt, startOfUtcDay(now))));
  return Number(row?.total ?? 0);
}

/**
 * Plan §4.5 item 7, in one transaction: delete the old `failed` row when this
 * was a retry; delete the organization's rows created before `retainAfter`;
 * insert the outcome, `ON CONFLICT DO NOTHING`. A retry on the same UTC day
 * carries `attempts + 1` (Q3 (a)), so the cap keeps counting the calls.
 */
export async function writeOutcome(
  tx: BmsTx,
  input: {
    readonly organizationId: string;
    readonly kind: MlFindingsKind;
    readonly factsHash: string;
    readonly outcome: ParagraphOutcome;
    readonly provider: string;
    readonly model: string;
    readonly retryOf: Pick<StoredParagraph, "id" | "attempts" | "createdAt"> | null;
    readonly now: Date;
    readonly retainAfter: Date;
  },
): Promise<void> {
  if (input.retryOf !== null) {
    await tx
      .delete(mlFindingParagraphs)
      .where(
        and(
          eq(mlFindingParagraphs.organizationId, input.organizationId),
          eq(mlFindingParagraphs.id, input.retryOf.id),
          eq(mlFindingParagraphs.status, "failed"),
        ),
      );
  }
  await tx
    .delete(mlFindingParagraphs)
    .where(and(eq(mlFindingParagraphs.organizationId, input.organizationId), lt(mlFindingParagraphs.createdAt, input.retainAfter)));
  const attempts =
    input.retryOf !== null && sameUtcDay(input.retryOf.createdAt, input.now) ? input.retryOf.attempts + 1 : 1;
  await tx
    .insert(mlFindingParagraphs)
    .values({
      organizationId: input.organizationId,
      kind: input.kind,
      factsHash: input.factsHash,
      status: input.outcome.status,
      paragraph: input.outcome.paragraph,
      reason: input.outcome.reason,
      provider: input.provider,
      model: input.model,
      attempts,
    })
    .onConflictDoNothing();
}

/** The store as the service holds it, so a spec can replace it with an in-memory fake. */
export const findingsParagraphStore = { readParagraph, attemptsToday, writeOutcome };
export type FindingsParagraphStore = typeof findingsParagraphStore;
