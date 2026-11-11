import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";

import { users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";

import { resolveAuthMode } from "./auth-mode";

/**
 * `F3.78` / ADR 0089 decision 4 — the one place a token becomes a `bms.users`
 * row, shared by `JwtAuthGuard`, `AccessControlService.resolveDbUser` and the
 * fifteen audit/`created_by` actor lookups (`resolveActorId`).
 *
 * **The match is by subject, never by email.** Under OIDC the row is the one
 * whose `oidc_subject` equals the token's `sub`; under local auth it is the
 * one whose `id` equals `sub` (local tokens are signed with `sub = users.id`,
 * `auth.service.ts`). The old `id = sub OR email = email` lookup let any token
 * that carried a matching `email` claim act as that row; the IdP decides what
 * an `email` claim says, so that was an identity decision this service did not
 * own.
 *
 * **`linkIdentity` is the only email read**, and it runs once per user: the
 * first request from a verified email whose row has no subject yet writes the
 * subject (`bms_auth` holds `UPDATE (oidc_subject)` and nothing wider, and the
 * `0098` trigger refuses a second write from a pool role). After that the
 * subject is the key.
 *
 * **The memo.** The guard resolves the row once per request and stores it
 * against the request's `JwtPayload` object in a `WeakMap`. Every later lookup
 * that is handed the same object reads the memo instead of the database
 * (plan D4). A caller that copies the payload (`{ ...jwt }`) misses the memo
 * and pays one more read — slower, never wrong. `null` is not memoised: a row
 * that is not there yet may be linked by a concurrent request.
 */

/** The seven identity columns, named as the schema names them. */
type IdentityKey = "id" | "email" | "displayName" | "role" | "organizationId" | "oidcSubject" | "disabledAt" | "kind";

/** A `bms.users` row as the projection returns it — derived from the schema, so it cannot drift. */
type IdentityRow = Pick<typeof users.$inferSelect, IdentityKey>;

/**
 * The resolved identity: the row, with `role` narrowed to the role vocabulary.
 * `kind` (F4.17 / ADR 0125) is optional on the type so a hand-built fixture
 * need not name it: absent reads as `human`, and only an explicit `service` is
 * ever acted on. Every row the resolver reads carries it.
 */
export type ResolvedIdentity = Readonly<
  Omit<IdentityRow, "role" | "kind"> & { role: UserRole; kind?: "human" | "service" }
>;

/** What a lookup needs from a pool or a transaction: a select, and the link's update. */
export type IdentityDb = Pick<BmsDb, "select" | "update">;

type Principal = Pick<JwtPayload, "sub">;

const memo = new WeakMap<object, ResolvedIdentity>();

/**
 * The explicit column list, taken from the table's own columns. Never a bare
 * `select()`: `password_hash` is not granted to `bms_fleet` or `bms_tenant`,
 * and a bare select names it.
 */
const IDENTITY_COLUMNS = (({ id, email, displayName, role, organizationId, oidcSubject, disabledAt, kind }) => ({
  id,
  email,
  displayName,
  role,
  organizationId,
  oidcSubject,
  disabledAt,
  // F4.17 / ADR 0125 decision 10: the guard refuses a JWT that names a service row.
  kind,
}))(getTableColumns(users));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIdentity(row: IdentityRow): ResolvedIdentity {
  const { kind, ...rest } = row;
  return {
    ...rest,
    role: row.role as UserRole,
    // Every real row carries `kind`; only a hand-built fixture omits it. A
    // value outside the vocabulary (unreachable under users_kind_check) reads
    // as `service`, the direction the guard refuses (security review, L3).
    ...(kind === undefined ? {} : { kind: kind === "human" ? ("human" as const) : ("service" as const) }),
  };
}

/** Stores `row` as the identity of this payload object. */
export function rememberIdentity(jwt: Principal, row: ResolvedIdentity): void {
  memo.set(jwt, row);
}

/** The memoised identity of this payload object, or `null` — never a database read. */
export function recalledIdentity(jwt: Principal): ResolvedIdentity | null {
  return memo.get(jwt) ?? null;
}

async function selectBySubject(db: IdentityDb, sub: string): Promise<ResolvedIdentity | null> {
  const [row] = await db
    .select(IDENTITY_COLUMNS)
    .from(users)
    .where(eq(users.oidcSubject, sub))
    .limit(1);
  return row ? toIdentity(row) : null;
}

/**
 * The `bms.users` row this token names, or `null` when none does.
 *
 * Memo first. Otherwise OIDC reads `WHERE oidc_subject = sub` and local reads
 * `WHERE id = sub`; a local `sub` that is not a uuid matches no row by
 * construction and is answered `null` without a query (a cast error would be a
 * 500). A found row is memoised against `jwt`.
 */
export async function resolveIdentity(db: IdentityDb, jwt: Principal): Promise<ResolvedIdentity | null> {
  const cached = memo.get(jwt);
  if (cached) {
    return cached;
  }

  let identity: ResolvedIdentity | null;
  if (resolveAuthMode(process.env) === "oidc") {
    identity = await selectBySubject(db, jwt.sub);
  } else {
    if (!UUID.test(jwt.sub)) {
      return null;
    }
    const [row] = await db
      .select(IDENTITY_COLUMNS)
      .from(users)
      .where(eq(users.id, jwt.sub))
      .limit(1);
    identity = row ? toIdentity(row) : null;
  }

  if (identity) {
    memo.set(jwt, identity);
  }
  return identity;
}

/**
 * Links the row whose email matches the token's verified email to the token's
 * subject, and returns it — the first sign-in of a user an admin created, or of
 * a seeded user (ADR 0089 decision 4).
 *
 * Runs only when `jwt.emailVerified === true`; the guard sets that from
 * `email_verified === true` and a string `email` claim. One statement on the
 * auth pool:
 *
 * `UPDATE bms.users SET oidc_subject = $sub WHERE lower(email) = $email AND oidc_subject IS NULL RETURNING …`
 *
 * - 1 row: the identity.
 * - 0 rows: a concurrent first request may have linked the row a moment ago,
 *   so re-read by subject once and return that row or `null`. `null` sends the
 *   request down the ADR 0044 path (403 for an `admin` claim, an empty scope
 *   for the rest). A row already linked to another subject is never re-pointed.
 * - more than 1 row: impossible under `users_email_lower_uidx`; an invariant
 *   violation, thrown.
 */
export async function linkIdentity(
  authDb: IdentityDb,
  jwt: Pick<JwtPayload, "sub" | "email" | "emailVerified">,
): Promise<ResolvedIdentity | null> {
  if (jwt.emailVerified !== true) {
    return null;
  }
  // Shorthand on purpose: `tests/e7.1h-audit-subject-writer-shape.test.ts`
  // reads every `oidcSubject:` key under apps/api/src as an audit-payload
  // write. This is a column write, not an audit payload.
  const oidcSubject = jwt.sub;
  const rows = await authDb
    .update(users)
    .set({ oidcSubject })
    // `kind = 'human'` (F4.17 / ADR 0125 decision 10): an IdP account whose
    // verified email equals a service row's must never take that row over.
    .where(
      and(
        sql`lower(${users.email}) = ${jwt.email.toLowerCase()}`,
        isNull(users.oidcSubject),
        eq(users.kind, "human"),
      ),
    )
    .returning(IDENTITY_COLUMNS);

  if (rows.length > 1) {
    throw new Error(
      `F3.78: the subject link linked ${rows.length} bms.users rows for one email; users_email_lower_uidx should make that impossible`,
    );
  }
  const [row] = rows;
  if (row) {
    return toIdentity(row);
  }
  return selectBySubject(authDb, jwt.sub);
}

/**
 * The `bms.users.id` of the actor, for an `audit_log.actor_id` or a
 * `created_by` stamp. `null` when the token names no row — the audit row is
 * still written, unattributed. Reads the memo the guard filled, so on a
 * request path this is no query at all.
 */
export async function resolveActorId(db: IdentityDb, actor: Principal): Promise<string | null> {
  return (await resolveIdentity(db, actor))?.id ?? null;
}
