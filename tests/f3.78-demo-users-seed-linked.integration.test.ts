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
const { seedPheOrganizationAdmin, seedScopedDemoUsers, upsertSeededUser } = require_(
  "../packages/db/dist/demo-users-seed.js",
) as typeof DemoUsersSeed;

/**
 * `F3.78` plan §5 (ADR 0089, review finding 15) — a re-seed (every
 * `compose up`) must not revert a change an admin made through the users API.
 * A row whose `oidc_subject` is set is administered through F3.78, so the
 * seed leaves that `bms.users` row untouched and writes none of its grants
 * (owner ruling 2026-10-03: a grant an admin removed stays removed); an
 * unlinked row keeps today's upsert and insert-if-absent grants.
 *
 * `upsertSeededUser` is the per-row step `seedScopedDemoUsers` and
 * `seedPheOrganizationAdmin` share; the grant cases drive those two through
 * their fixture-list parameter. Every case uses its **own** fixture user, inserted as the superuser inside one transaction that is
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

describe.skipIf(!superuserUrl)("F3.78 — the demo-users seed touches neither a linked users row nor its grants", { timeout: 60_000 }, () => {
  let pool: Pool | undefined;
  let db: Db;
  let eskomId = "";
  let phewbId = "";
  /** An ESKOM location with an `hvac` asset group under it, and that group. */
  let hvacLocationId = "";
  let hvacGroupId = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(superuserUrl as string, "F3.78");
    db = createDb(pool);
    const org = await pool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    eskomId = org.rows[0]?.id ?? "";
    if (eskomId === "") throw new Error("run pnpm db:seed first");
    const phewb = await pool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'PHEWB'`);
    phewbId = phewb.rows[0]?.id ?? "";
    const hvac = await pool.query<{ id: string; location_id: string }>(
      `SELECT g.id, g.location_id FROM bms.asset_groups g JOIN bms.locations l ON l.id = g.location_id
        WHERE g.code = 'hvac' AND l.organization_id = $1 ORDER BY g.created_at, g.id LIMIT 1`,
      [eskomId],
    );
    hvacGroupId = hvac.rows[0]?.id ?? "";
    hvacLocationId = hvac.rows[0]?.location_id ?? "";
    if (phewbId === "" || hvacGroupId === "") throw new Error("run pnpm db:seed first");
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

  type GrantKind = "location" | "asset_group" | "organization";

  /**
   * Inserts a fixture user (linked or not) holding one grant of `kind`,
   * removes that grant (an admin's change through the grants API), re-runs the
   * seed path that writes that grant with the fixture as its only user, and
   * returns how many grants of `kind` the user holds afterwards. Rolled back.
   */
  async function reseedAfterAGrantRemoval(kind: GrantKind, linked: boolean): Promise<number> {
    let after: number | undefined;
    const id = randomUUID();
    const email = `f3.78-pr2-seed-${id}@fixture.local`;
    const role = kind === "location" ? "location_admin" : kind === "asset_group" ? "asset_group_admin" : "organization_admin";
    const home = kind === "organization" ? phewbId : eskomId;
    const grant = {
      location: { table: "bms.user_location_access", column: "location_id", target: hvacLocationId },
      asset_group: { table: "bms.user_asset_group_access", column: "asset_group_id", target: hvacGroupId },
      organization: { table: "bms.user_organization_access", column: "organization_id", target: phewbId },
    }[kind];
    const spec = { email, password: "admin123", displayName: "Seed name" };
    await db
      .transaction(async (tx: Tx) => {
        const client = tx as unknown as Db;
        await client.execute(
          `INSERT INTO bms.users (id, organization_id, email, display_name, role, oidc_subject)
           VALUES ('${id}', '${home}', '${email}', 'Admin-chosen name', '${role}', ${
             linked ? `'f3.78-pr2-seed-sub-${id}'` : "NULL"
           })` as never,
        );
        await client.execute(
          `INSERT INTO ${grant.table} (user_id, ${grant.column}) VALUES ('${id}', '${grant.target}')` as never,
        );
        await client.execute(`DELETE FROM ${grant.table} WHERE user_id = '${id}'` as never);
        if (kind === "organization") {
          await seedPheOrganizationAdmin(client, pool as never, { ...spec, role });
        } else {
          await seedScopedDemoUsers(client, eskomId, hvacLocationId, [
            { ...spec, role: kind === "location" ? "location_admin" : "asset_group_admin" },
          ]);
        }
        const rows = (await client.execute(
          `SELECT count(*)::int AS n FROM ${grant.table} WHERE user_id = '${id}'` as never,
        )) as unknown as { rows: Array<{ n: number }> };
        after = rows.rows[0]?.n;
        throw new Rollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof Rollback)) throw err;
      });
    if (after === undefined) throw new Error("F3.78: the grant case never read its grants back");
    return after;
  }

  it("a re-seed leaves a linked location admin without the location grant an admin removed", async () => {
    expect(await reseedAfterAGrantRemoval("location", true)).toBe(0);
  });

  it("a re-seed restores an unlinked location admin's location grant (positive control)", async () => {
    expect(await reseedAfterAGrantRemoval("location", false)).toBe(1);
  });

  it("a re-seed leaves a linked asset-group admin without the hvac grant an admin removed", async () => {
    expect(await reseedAfterAGrantRemoval("asset_group", true)).toBe(0);
  });

  it("a re-seed restores an unlinked asset-group admin's hvac grant (positive control)", async () => {
    expect(await reseedAfterAGrantRemoval("asset_group", false)).toBe(1);
  });

  it("a re-seed leaves a linked organization admin without the organization grant an admin removed", async () => {
    expect(await reseedAfterAGrantRemoval("organization", true)).toBe(0);
  });

  it("a re-seed restores an unlinked organization admin's organization grant (positive control)", async () => {
    expect(await reseedAfterAGrantRemoval("organization", false)).toBe(1);
  });

  it("leaves no fixture user behind", async () => {
    const { rows } = await (pool as Pool).query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bms.users WHERE email LIKE 'f3.78-pr2-seed-%@fixture.local'`,
    );
    expect(rows[0]?.n).toBe(0);
  });
});
