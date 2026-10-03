import { randomUUID } from "node:crypto";

import { eq, isNull, sql } from "drizzle-orm";
import { expect } from "vitest";

import { users } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { withRollback } from "../testing/with-rollback";
import { AccessControlService } from "./access-control.service";
import { linkIdentity, type ResolvedIdentity } from "./identity-resolver";

/**
 * `F3.78` / ADR 0089 decisions 4 and 8 — the subject link and the
 * `disabled_at` read on a real `bms_auth` connection: the grants `0098` gives
 * that role (`UPDATE (oidc_subject)`, `SELECT (disabled_at)`) and the
 * `auth_bootstrap_write` policy are what the guard's two statements need, and
 * a fake proves neither.
 *
 * Every case runs inside `withRollback(…)` and calls `tx.rollback()` — the two
 * link cases on the superuser pool, switched to `bms_auth` after they insert
 * their own unlinked user (`anUnlinkedUserAsAuth`) —
 * so the subject it writes never outlives the case
 * (`tests/f3.60-withrollback-cases-roll-back.test.ts`). The `0098` trigger
 * refuses a pool role's second write to a set subject, so a committed link
 * here would be permanent on the shared database.
 */

type Unlinked = { id: string; email: string };

/**
 * The case's own unlinked user, inserted by the superuser inside the case's
 * transaction, then `SET LOCAL ROLE bms_auth` so every later statement runs as
 * the auth role. A seeded row is not used: once anyone signs in on the shared
 * database, every seeded row is linked and stays linked (the `0098` trigger),
 * so a case that borrows one goes red for a reason that has nothing to do with
 * the code. `bms_auth` cannot insert a user, hence the superuser and the role
 * switch; the rollback removes the row.
 */
async function anUnlinkedUserAsAuth(tx: Pick<BmsDb, "execute">): Promise<Unlinked> {
  const id = randomUUID();
  const email = `f3.78-link-${id}@fixture.local`;
  await tx.execute(sql`
    INSERT INTO bms.users (id, organization_id, email, display_name, role)
    SELECT ${id}::uuid, o.id, ${email}, 'F3.78 link fixture', 'viewer'
      FROM bms.organizations o
     ORDER BY o.created_at, o.code
     LIMIT 1
  `);
  await tx.execute(sql`SET LOCAL ROLE bms_auth`);
  // Without this, a dropped role switch would let the case pass as the superuser.
  const role = await tx.execute(sql`SELECT current_user AS name`);
  const name = (role as unknown as { rows: Array<{ name: string }> }).rows[0]?.name;
  if (name !== "bms_auth") {
    throw new Error(`F3.78: the link case must run as bms_auth, not ${name ?? "nobody"}`);
  }
  return { id, email };
}

export async function assertTheLinkChangesOneRowOnTheAuthRole(superDb: BmsDb): Promise<void> {
  let linked: ResolvedIdentity | null = null;
  let user: Unlinked | undefined;
  const sub = `f3.78-link-${randomUUID()}`;
  await withRollback(superDb, async (tx) => {
    user = await anUnlinkedUserAsAuth(tx);
    // Upper-cased: the link matches lower(email), so the claim's case does not matter.
    linked = await linkIdentity(tx, { sub, email: user.email.toUpperCase(), emailVerified: true });
    tx.rollback();
  });
  expect(linked).not.toBeNull();
  expect((linked as ResolvedIdentity | null)?.id).toBe(user?.id);
  expect((linked as ResolvedIdentity | null)?.oidcSubject).toBe(sub);
}

export async function assertASecondLinkChangesNothing(superDb: BmsDb): Promise<void> {
  let second: ResolvedIdentity | null | undefined;
  let subjectAfter: string | null | undefined;
  await withRollback(superDb, async (tx) => {
    const user = await anUnlinkedUserAsAuth(tx);
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
    rows = await tx
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(users)
      .orderBy(users.createdAt, users.id)
      .limit(1);
    tx.rollback();
  });
  expect(rows).toHaveLength(1);
}

type DisabledReads = {
  disabled: boolean;
  enabled: boolean;
  enabledVisible: number;
  listed: string[];
  targetId: string;
};

/**
 * `AccessControlService.isUserDisabled` itself, as `bms_auth` — the handshake
 * re-read (decision 8) every gateway spec stubs. `bms_auth` holds no
 * `UPDATE (disabled_at)`, so the superuser sets it inside the transaction and
 * then drops to `bms_auth` with `SET LOCAL ROLE`; the reads run on that role
 * and see the uncommitted stamp. `enabledVisible` is the positive control: a
 * `false` for a row `bms_auth` cannot see would pass vacuously.
 */
async function readDisabledAsAuth(superDb: BmsDb): Promise<DisabledReads> {
  let reads: DisabledReads | undefined;
  await withRollback(superDb, async (tx) => {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(isNull(users.disabledAt))
      .orderBy(users.createdAt, users.id)
      .limit(2);
    const [target, other] = rows;
    if (!target || !other) {
      throw new Error("F3.78: fewer than two enabled bms.users rows — run pnpm db:seed on a fresh database");
    }
    await tx.update(users).set({ disabledAt: new Date() }).where(eq(users.id, target.id));
    await tx.execute(sql`SET LOCAL ROLE bms_auth`);
    const access = new AccessControlService(tx as unknown as BmsDb, tx as unknown as BmsDb);
    const visible = await tx.select({ id: users.id }).from(users).where(eq(users.id, other.id));
    reads = {
      disabled: await access.isUserDisabled(target.id),
      enabled: await access.isUserDisabled(other.id),
      enabledVisible: visible.length,
      listed: await access.disabledUserIds([target.id, other.id]),
      targetId: target.id,
    };
    tx.rollback();
  });
  if (!reads) throw new Error("F3.78: the disabled_at reads never ran");
  return reads;
}

export async function assertIsUserDisabledIsTrueForAStampedRow(superDb: BmsDb): Promise<void> {
  expect((await readDisabledAsAuth(superDb)).disabled).toBe(true);
}

export async function assertIsUserDisabledIsFalseForAnEnabledRow(superDb: BmsDb): Promise<void> {
  const reads = await readDisabledAsAuth(superDb);
  expect(reads.enabledVisible, "positive control: bms_auth sees the enabled row").toBe(1);
  expect(reads.enabled).toBe(false);
}

/** The catch-up read: of two ids, one stamped and one enabled, only the stamped one comes back. */
export async function assertDisabledUserIdsListsOnlyTheStampedRow(superDb: BmsDb): Promise<void> {
  const reads = await readDisabledAsAuth(superDb);
  expect(reads.enabledVisible, "positive control: bms_auth sees the enabled row").toBe(1);
  expect(reads.listed).toEqual([reads.targetId]);
}
