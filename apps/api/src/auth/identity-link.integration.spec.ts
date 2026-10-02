import { randomUUID } from "node:crypto";

import { eq, isNull } from "drizzle-orm";
import { expect } from "vitest";

import { users } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { withRollback } from "../testing/with-rollback";
import { linkIdentity, type ResolvedIdentity } from "./identity-resolver";

/**
 * `F3.78` / ADR 0089 decisions 4 and 8 — the subject link and the
 * `disabled_at` read on a real `bms_auth` connection: the grants `0098` gives
 * that role (`UPDATE (oidc_subject)`, `SELECT (disabled_at)`) and the
 * `auth_bootstrap_write` policy are what the guard's two statements need, and
 * a fake proves neither.
 *
 * Every case runs inside `withRollback(authDb, …)` and calls `tx.rollback()`,
 * so the subject it writes never outlives the case
 * (`tests/f3.60-withrollback-cases-roll-back.test.ts`). The `0098` trigger
 * refuses a pool role's second write to a set subject, so a committed link
 * here would be permanent on the shared database.
 */

type Unlinked = { id: string; email: string };

/** A seeded row the auth role sees with no subject yet — the state every local seed leaves. */
async function anUnlinkedUser(tx: Pick<BmsDb, "select">): Promise<Unlinked> {
  const [row] = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(isNull(users.oidcSubject))
    .orderBy(users.email)
    .limit(1);
  if (!row) {
    throw new Error("F3.78: no bms.users row has a NULL oidc_subject — run pnpm db:seed on a fresh database");
  }
  return row;
}

export async function assertTheLinkChangesOneRowOnTheAuthRole(authDb: BmsDb): Promise<void> {
  let linked: ResolvedIdentity | null = null;
  let user: Unlinked | undefined;
  const sub = `f3.78-link-${randomUUID()}`;
  await withRollback(authDb, async (tx) => {
    user = await anUnlinkedUser(tx);
    // Upper-cased: the link matches lower(email), so the claim's case does not matter.
    linked = await linkIdentity(tx, { sub, email: user.email.toUpperCase(), emailVerified: true });
    tx.rollback();
  });
  expect(linked).not.toBeNull();
  expect((linked as ResolvedIdentity | null)?.id).toBe(user?.id);
  expect((linked as ResolvedIdentity | null)?.oidcSubject).toBe(sub);
}

export async function assertASecondLinkChangesNothing(authDb: BmsDb): Promise<void> {
  let second: ResolvedIdentity | null | undefined;
  let subjectAfter: string | null | undefined;
  await withRollback(authDb, async (tx) => {
    const user = await anUnlinkedUser(tx);
    const first = `f3.78-first-${randomUUID()}`;
    await linkIdentity(tx, { sub: first, email: user.email, emailVerified: true });
    second = await linkIdentity(tx, { sub: `f3.78-second-${randomUUID()}`, email: user.email, emailVerified: true });
    const [row] = await tx
      .select({ oidcSubject: users.oidcSubject })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    subjectAfter = row?.oidcSubject;
    tx.rollback();
  });
  expect(second).toBeNull();
  expect(subjectAfter).toMatch(/^f3\.78-first-/);
}

export async function assertTheAuthRoleReadsDisabledAt(authDb: BmsDb): Promise<void> {
  let rows: unknown[] = [];
  await withRollback(authDb, async (tx) => {
    rows = await tx.select({ id: users.id, disabledAt: users.disabledAt }).from(users).limit(1);
    tx.rollback();
  });
  expect(rows).toHaveLength(1);
}
