import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as DbClient from "../packages/db/dist/client.js";
import type * as DemoUsersSeed from "../packages/db/dist/demo-users-seed.js";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

// Loaded from `packages/db/dist` through `createRequire`, for the reason
// `tests/f4.129-ladder-rule-code-bound.integration.test.ts` gives. After a source edit, run
// `pnpm --filter @bms/db build` before this suite, or it runs the last build.
const require_ = createRequire(import.meta.url);
const { createDb } = require_("../packages/db/dist/client.js") as typeof DbClient;
const { upsertSeededUser } = require_("../packages/db/dist/demo-users-seed.js") as typeof DemoUsersSeed;

/**
 * `F3.78` plan §5 (ADR 0089, review finding 15) — a re-seed (every
 * `compose up`) must not revert a change an admin made through the users API.
 * A row whose `oidc_subject` is set is administered through F3.78, so the
 * seed leaves that `bms.users` row untouched; an unlinked row keeps today's
 * upsert. (The callers' grant writes stay insert-if-absent: see the helper's
 * docblock.)
 *
 * `upsertSeededUser` is the per-row step `seedScopedDemoUsers` and
 * `seedPheOrganizationAdmin` share. The cases drive it with their **own**
 * fixture user, inserted as the superuser inside one transaction that is
 * rolled back: a real seeded admin is never changed, and the linked fixture's
 * subject is never committed (the `0098` trigger makes a committed link
 * permanent for a pool role). The seed itself runs on the superuser connection,
 * as `pnpm db:seed` runs the identity functions.
 */

const superuserUrl = requireIntegrationDb({
  item: "F3.78",
  label: "the demo-users seed guard on a linked row",
  because:
    "that a re-seed leaves a linked row's role alone, and still resets an unlinked one, is what " +
    "stops every compose up from silently reverting an admin's demotion with no audit row.",
  connection: "superuser",
});

type Pool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Db = ReturnType<typeof createDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Thrown to roll the case's transaction back once it has read what it needs. */
class Rollback extends Error {}

describe.skipIf(!superuserUrl)("F3.78 — the demo-users seed leaves a linked users row untouched", { timeout: 60_000 }, () => {
  let pool: Pool | undefined;
  let db: Db;
  let eskomId = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(superuserUrl as string, "F3.78");
    db = createDb(pool);
    const org = await pool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    eskomId = org.rows[0]?.id ?? "";
    if (eskomId === "") throw new Error("run pnpm db:seed first");
  });

  afterAll(async () => {
    await pool?.end();
  });

  /**
   * Inserts a fixture user as `viewer` (linked or not), changes its role to
   * `operator` (an admin's change), runs the seed's upsert with the seed's own
   * values (`viewer`), and returns the role and name left on the row. Rolled back.
   */
  async function reseedAfterARoleChange(linked: boolean): Promise<{ role: string; displayName: string }> {
    let after: { role: string; displayName: string } | undefined;
    const id = randomUUID();
    const email = `f3.78-pr2-seed-${id}@fixture.local`;
    await db
      .transaction(async (tx: Tx) => {
        const client = tx as unknown as Db;
        await client.execute(
          `INSERT INTO bms.users (id, organization_id, email, display_name, role, oidc_subject)
           VALUES ('${id}', '${eskomId}', '${email}', 'Admin-chosen name', 'viewer', ${
             linked ? `'f3.78-pr2-seed-sub-${id}'` : "NULL"
           })` as never,
        );
        await client.execute(`UPDATE bms.users SET role = 'operator' WHERE id = '${id}'` as never);
        await upsertSeededUser(client, {
          email,
          password: "admin123",
          displayName: "Seed name",
          role: "viewer",
          organizationId: eskomId,
        });
        const rows = (await client.execute(
          `SELECT role, display_name FROM bms.users WHERE id = '${id}'` as never,
        )) as unknown as { rows: Array<{ role: string; display_name: string }> };
        const row = rows.rows[0];
        after = row ? { role: row.role, displayName: row.display_name } : undefined;
        throw new Rollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof Rollback)) throw err;
      });
    if (!after) throw new Error("F3.78: the seed case never read its row back");
    return after;
  }

  it("a re-seed after a role change on a linked row leaves the role unchanged", async () => {
    expect((await reseedAfterARoleChange(true)).role).toBe("operator");
  });

  it("a re-seed on a linked row leaves its display name unchanged", async () => {
    expect((await reseedAfterARoleChange(true)).displayName).toBe("Admin-chosen name");
  });

  it("a re-seed after a role change on an unlinked row restores the seed's role (positive control)", async () => {
    expect((await reseedAfterARoleChange(false)).role).toBe("viewer");
  });

  it("leaves no fixture user behind", async () => {
    const { rows } = await (pool as Pool).query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bms.users WHERE email LIKE 'f3.78-pr2-seed-%@fixture.local'`,
    );
    expect(rows[0]?.n).toBe(0);
  });
});
