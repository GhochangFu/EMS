import type pg from "pg";

import type { JwtPayload, UserRole } from "@bms/shared";

/**
 * `F3.78` (ADR 0089 decision 4) — token payloads for the integration suites
 * whose `sub` is the user's real `bms.users.id`.
 *
 * Local auth signs `sub = bms.users.id`, and ADR 0089 decision 4 has the
 * resolver match **`id = sub`** in local mode, with no email fallback. Before
 * this module the suites set `sub` to a value that matched no row and relied on
 * the email branch to find the user — a branch that no longer exists once the
 * resolver changes. Priming once per suite and reading the id back keeps every
 * suite green on both resolvers.
 *
 * Lives here rather than in `auth/access-control.integration.spec.ts` (which
 * re-exports it, so its importers are unchanged) because that file sits at the
 * §4.5 line cap.
 */

/** Emails seeded by `packages/db/src/seed.ts`, one per read-scope source. */
export const SEEDED = {
  globalAdmin: "admin@bms.local",
  organizationAdmin: "phe-admin@bms.local",
  locationAdmin: "wc-admin@bms.local",
  assetGroupAdmin: "wc-hvac-admin@bms.local",
} as const;

/**
 * A `sub` that matches no `bms.users.id` — `assertFixturesPresent` proves it.
 * Only `jwtForUnprovisioned` uses it: the deliberately unknown principal.
 */
export const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000000";

/**
 * Email → `bms.users.id` for every row `primeSeededSubjects` read. Module-level,
 * so each test file (its own module instance under Vitest) primes its own copy.
 */
const seededSubjects = new Map<string, string>();

/**
 * Reads every user's id and email once, so `jwtFor` can carry the real id as
 * `sub`.
 *
 * Call it in each suite's `beforeAll` — or inside an async fixture loader —
 * **before** the first `jwtFor`, and never at describe scope: the describe body
 * runs at collection time, before any `beforeAll`. `pool` must see `bms.users`
 * without a tenant GUC: the superuser, `bms_fleet` (`BYPASSRLS`) or `bms_auth`
 * (its `auth_bootstrap_read` policy). `bms_owner` and `bms_tenant` are bound by
 * FORCE ROW LEVEL SECURITY and see no row, so this throws naming the cause
 * rather than leave every later `jwtFor` failing.
 */
export async function primeSeededSubjects(pool: Pick<pg.Pool, "query">): Promise<void> {
  const { rows } = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM bms.users`,
  );
  for (const row of rows) {
    seededSubjects.set(row.email, row.id);
  }
  const missing = Object.values(SEEDED).filter((email) => !seededSubjects.has(email));
  if (missing.length > 0) {
    throw new Error(
      `F3.78 primeSeededSubjects: ${missing.join(", ")} not visible (${rows.length} bms.users ` +
        "rows read). Pass the superuser, bms_fleet or bms_auth pool — bms_owner and bms_tenant see no " +
        "user row under FORCE ROW LEVEL SECURITY — and run 'pnpm db:seed'.",
    );
  }
}

/**
 * Records a user the suite inserted itself, so `jwtFor` can carry its id. Call
 * it with the id the `INSERT … RETURNING id` gave back — never re-read by email.
 */
export function rememberSubject(email: string, id: string): void {
  seededSubjects.set(email, id);
}

/**
 * Builds a token payload for a **provisioned** user: `sub` is that row's id,
 * exactly what local auth signs. The email no longer decides the row.
 *
 * Fails closed: an email `primeSeededSubjects` did not read throws, so a suite
 * that forgot to prime goes red instead of silently resolving through the
 * claim. A deliberately unknown principal uses `jwtForUnprovisioned`.
 */
export function jwtFor(email: string, role: UserRole): JwtPayload {
  const sub = seededSubjects.get(email);
  if (sub === undefined) {
    throw new Error(
      `F3.78 jwtFor: no primed bms.users id for ${email}. Call primeSeededSubjects(pool) ` +
        "in beforeAll first, or use jwtForUnprovisioned for a principal with no row.",
    );
  }
  return { sub, email, name: `integration:${email}`, role };
}

/**
 * `jwtFor` for a payload declared at module scope, which runs at import time —
 * before any `beforeAll` could prime. `sub` is a getter that resolves on first
 * read, so the payload is built eagerly and its id looked up only when a test
 * uses it; an unprimed email still throws, at that read.
 */
export function lazyJwtFor(email: string, role: UserRole): JwtPayload {
  return {
    get sub(): string {
      return jwtFor(email, role).sub;
    },
    email,
    name: `integration:${email}`,
    role,
  };
}

/**
 * A token for a principal with **no** `bms.users` row: `sub` is
 * `SYNTHETIC_SUB`, which matches no id, so `resolveDbUser` takes the ADR 0044
 * path — 403 for an `admin` claim, the claim with an empty scope for the rest.
 */
export function jwtForUnprovisioned(email: string, role: UserRole): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

/**
 * `jwtFor` throws for an email nobody primed. DB-free, so a wrapper can run it
 * whether or not a database is configured.
 */
export function assertJwtForFailsClosed(): void {
  const email = "never-primed@integration.invalid";
  try {
    jwtFor(email, "viewer");
  } catch (err) {
    if (err instanceof Error && err.message.includes(`no primed bms.users id for ${email}`)) {
      return;
    }
    throw new Error(`jwtFor threw the wrong error for an unprimed email: ${String(err)}`);
  }
  throw new Error("jwtFor returned a payload for an email primeSeededSubjects never read");
}
