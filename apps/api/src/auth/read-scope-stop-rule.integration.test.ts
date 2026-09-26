import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, type BmsDb } from "@bms/db";
import type { UserRole } from "@bms/shared";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { AccessControlService } from "./access-control.service";
import { jwtFor } from "./access-control.integration.spec";
import type { ReadScopeSource } from "./access-scope";
import {
  assertProbeMatchesScopeFromSource,
  assertReadableOrganizationIds,
  assertScopeFailsClosedToNone,
  assertScopeFallsThroughToLocationGrant,
} from "./read-scope-stop-rule.integration.spec";

/**
 * `F4.161` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * Fixtures are committed with a per-run suffix and deleted by id in `afterAll`
 * (a transaction handle is `BmsTx`, not the `BmsDb` the service takes). The
 * fixture organization carries one location, and it is INACTIVE, with the one
 * fixture asset group under it: every active-filtered read elsewhere is blind to
 * them, and no other suite's oldest-group pick can land on a fixture group.
 */
const connectionString = requireIntegrationDb({
  item: "F4.161",
  label: "readableOrganizationIds and scopeForUser share one source selection",
  because:
    "The mixed-grant cases turn on which grant source reaches an active site, which only real " +
    "bms.locations / user_*_access rows on bms_fleet can decide; a fake cannot tell an inactive " +
    "location's grant from an active one's, and the probe's equivalence to scopeFromSource is a " +
    "claim about the SQL itself.",
});

// Identity and grant rows insert only through the superuser under FORCE (see
// multi-org-scope.rls.integration.test.ts); this file reaches it only through
// the gate, per ADR 0045's owner-and-superuser-url invariant.
const superuserConnectionString = requireIntegrationDb({
  item: "F4.161",
  label: "F4.161 fixture identity and grant rows under FORCE",
  because:
    "bms.users and the three user_*_access tables accept inserts only from the superuser under " +
    "FORCE. Setup and teardown alone use it; every assertion runs on bms_auth / bms_fleet.",
  connection: "superuser",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const emailFor = (label: string): string => `f4161-${label}-${RUN}@integration.invalid`;

type Actor = { email: string; role: UserRole; id: string };

describe.skipIf(!connectionString)("F4.161 — one read-scope source selection", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let superPool: pg.Pool;
  let fleetDb: BmsDb;
  let svc: AccessControlService;

  let eskomId = "";
  let phewbId = "";
  let eskomSiteId = "";
  let hvacGroupId = "";
  let orgEmptyId = "";
  let locInactiveId = "";
  let groupInactiveId = "";

  const actors: Record<"vA" | "vB" | "vC" | "oP" | "oa" | "la" | "ga", Actor> = {
    vA: { email: emailFor("va"), role: "viewer", id: "" },
    vB: { email: emailFor("vb"), role: "viewer", id: "" },
    vC: { email: emailFor("vc"), role: "viewer", id: "" },
    oP: { email: emailFor("op"), role: "operator", id: "" },
    oa: { email: emailFor("oa"), role: "organization_admin", id: "" },
    la: { email: emailFor("la"), role: "location_admin", id: "" },
    ga: { email: emailFor("ga"), role: "asset_group_admin", id: "" },
  };
  const jwt = (actor: Actor) => jwtFor(actor.email, actor.role);

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F4.161"); // fleet (BYPASSRLS) by default
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.161",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F4.161");
    fleetDb = createDb(fleetPool);
    svc = new AccessControlService(createDb(authPool), fleetDb);

    // Seeded rows, read only. ORDER BY created_at, id wherever one is taken (F4.53).
    const orgs = await fleetPool.query<{ id: string; code: string }>(
      "SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB') ORDER BY created_at, id",
    );
    eskomId = orgs.rows.find((row) => row.code === "ESKOM")?.id ?? "";
    phewbId = orgs.rows.find((row) => row.code === "PHEWB")?.id ?? "";
    if (!eskomId || !phewbId) {
      throw new Error("F4.161: the ESKOM and PHEWB organizations are missing — run pnpm db:seed.");
    }

    const site = await fleetPool.query<{ id: string; active: boolean; organization_id: string }>(
      `SELECT l.id, l.active, l.organization_id
         FROM bms.user_location_access ula
         JOIN bms.users u ON u.id = ula.user_id
         JOIN bms.locations l ON l.id = ula.location_id
        WHERE u.email = 'wc-admin@bms.local'
        ORDER BY l.created_at, l.id
        LIMIT 1`,
    );
    const siteRow = site.rows[0];
    if (!siteRow || !siteRow.active || siteRow.organization_id !== eskomId) {
      throw new Error("F4.161: wc-admin@bms.local must hold an active ESKOM location — run pnpm db:seed.");
    }
    eskomSiteId = siteRow.id;

    const group = await fleetPool.query<{ id: string; active: boolean; organization_id: string }>(
      `SELECT g.id, l.active, g.organization_id
         FROM bms.user_asset_group_access uaga
         JOIN bms.users u ON u.id = uaga.user_id
         JOIN bms.asset_groups g ON g.id = uaga.asset_group_id
         JOIN bms.locations l ON l.id = g.location_id
        WHERE u.email = 'wc-hvac-admin@bms.local'
        ORDER BY g.created_at, g.id
        LIMIT 1`,
    );
    const groupRow = group.rows[0];
    if (!groupRow || !groupRow.active || groupRow.organization_id !== eskomId) {
      throw new Error(
        "F4.161: wc-hvac-admin@bms.local must hold an ESKOM group under an active location — run pnpm db:seed.",
      );
    }
    hvacGroupId = groupRow.id;

    // Fixture rows: an organization whose one location is inactive, and a group under it.
    const org = await fleetPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'ZAR') RETURNING id",
      [`F4161-EMPTY-${RUN}`, "F4.161 fixture organization with no active site"],
    );
    orgEmptyId = org.rows[0]!.id;
    const loc = await fleetPool.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
       VALUES ($1, $2, $3, $4, 'site', 0, 0, false) RETURNING id`,
      [orgEmptyId, `F4161-INACTIVE-${RUN}`, `f4161-inactive-${RUN}`, "F4.161 fixture inactive site"],
    );
    locInactiveId = loc.rows[0]!.id;
    const grp = await fleetPool.query<{ id: string }>(
      `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [orgEmptyId, locInactiveId, `f4161-grp-${RUN}`, "F4.161 fixture group under an inactive site"],
    );
    groupInactiveId = grp.rows[0]!.id;

    const activeInEmpty = await fleetPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM bms.locations WHERE organization_id = $1 AND active = true",
      [orgEmptyId],
    );
    if (activeInEmpty.rows[0]?.n !== 0) {
      throw new Error("F4.161: the fixture organization must have zero active locations.");
    }

    for (const actor of Object.values(actors)) {
      const row = await superPool.query<{ id: string }>(
        `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
           VALUES ($1, 'x', $2, $3, $4) RETURNING id`,
        [actor.email, `F4.161 ${actor.role}`, actor.role, orgEmptyId],
      );
      actor.id = row.rows[0]!.id;
    }

    const grantOrg = (userId: string, organizationId: string) =>
      superPool.query("INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)", [
        userId,
        organizationId,
      ]);
    const grantLocation = (userId: string, locationId: string) =>
      superPool.query("INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)", [
        userId,
        locationId,
      ]);
    const grantGroup = (userId: string, assetGroupId: string) =>
      superPool.query("INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES ($1, $2)", [
        userId,
        assetGroupId,
      ]);

    await grantOrg(actors.vA.id, orgEmptyId);
    await grantLocation(actors.vA.id, eskomSiteId);
    await grantLocation(actors.vB.id, locInactiveId);
    await grantGroup(actors.vB.id, hvacGroupId);
    await grantGroup(actors.vC.id, groupInactiveId);
    await grantOrg(actors.oP.id, phewbId);
    await grantOrg(actors.oa.id, orgEmptyId);
    await grantLocation(actors.la.id, locInactiveId);
    await grantGroup(actors.ga.id, groupInactiveId);
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    const attempt = async (sql: string, params: unknown[]): Promise<void> => {
      try {
        await superPool.query(sql, params);
      } catch (err) {
        errors.push(err);
      }
    };
    if (superPool) {
      const userIds = Object.values(actors)
        .map((actor) => actor.id)
        .filter(Boolean);
      if (userIds.length > 0) {
        await attempt("DELETE FROM bms.user_organization_access WHERE user_id = ANY($1::uuid[])", [userIds]);
        await attempt("DELETE FROM bms.user_location_access WHERE user_id = ANY($1::uuid[])", [userIds]);
        await attempt("DELETE FROM bms.user_asset_group_access WHERE user_id = ANY($1::uuid[])", [userIds]);
        await attempt("DELETE FROM bms.users WHERE id = ANY($1::uuid[])", [userIds]);
      }
      if (groupInactiveId) await attempt("DELETE FROM bms.asset_groups WHERE id = $1", [groupInactiveId]);
      if (locInactiveId) await attempt("DELETE FROM bms.locations WHERE id = $1", [locInactiveId]);
      if (orgEmptyId) await attempt("DELETE FROM bms.organizations WHERE id = $1", [orgEmptyId]);
    }
    await Promise.all([fleetPool, authPool, superPool].filter(Boolean).map((pool) => pool.end()));
    if (errors.length > 0) {
      throw new AggregateError(errors, `F4.161 cleanup: ${errors.length} delete(s) failed`);
    }
  });

  // --- readableOrganizationIds -------------------------------------------------

  it("S1: an org grant with no active site beside an ESKOM site grant reads ESKOM", async () => {
    await assertReadableOrganizationIds(svc, jwt(actors.vA), [eskomId]);
  });

  it("S2: an inactive site grant beside an active ESKOM group grant reads ESKOM", async () => {
    await assertReadableOrganizationIds(svc, jwt(actors.vB), [eskomId]);
  });

  it("S3: a group grant under an inactive site alone reads no organization", async () => {
    await assertReadableOrganizationIds(svc, jwt(actors.vC), []);
  });

  it("S4: an operator's plain PHEWB org grant reads PHEWB", async () => {
    await assertReadableOrganizationIds(svc, jwt(actors.oP), [phewbId]);
  });

  it("S5: organization_admin keeps its org with no active site (single source, never probed)", async () => {
    await assertReadableOrganizationIds(svc, jwt(actors.oa), [orgEmptyId]);
  });

  it("S6: location_admin keeps its inactive site's org (single source, never probed)", async () => {
    await assertReadableOrganizationIds(svc, jwt(actors.la), [orgEmptyId]);
  });

  it("S7: asset_group_admin keeps its inactive-site group's org (single source, never probed)", async () => {
    await assertReadableOrganizationIds(svc, jwt(actors.ga), [orgEmptyId]);
  });

  // --- scopeForUser invariance (plan D5) -------------------------------------

  it("S8: currentUser for the org-plus-site viewer is a location scope on the ESKOM site", async () => {
    await assertScopeFallsThroughToLocationGrant(svc, jwt(actors.vA), eskomSiteId);
  });

  it("S9: currentUser for the inactive-group viewer fails closed to none", async () => {
    await assertScopeFailsClosedToNone(svc, jwt(actors.vC));
  });

  // --- the probe equals scopeFromSource's "has a location or asset" ----------

  const probeCases: ReadonlyArray<readonly [string, "vA" | "vB" | "vC", ReadScopeSource]> = [
    ["E1", "vA", "organization"],
    ["E2", "vA", "location"],
    ["E3", "vA", "asset_group"],
    ["E4", "vB", "organization"],
    ["E5", "vB", "location"],
    ["E6", "vB", "asset_group"],
    ["E7", "vC", "organization"],
    ["E8", "vC", "location"],
    ["E9", "vC", "asset_group"],
  ];
  for (const [label, key, source] of probeCases) {
    it(`${label}: readScopeSourceYields(${key}, ${source}) equals scopeFromSource has a location or asset`, async () => {
      const actor = actors[key];
      await assertProbeMatchesScopeFromSource(fleetDb, { id: actor.id, role: actor.role }, source);
    });
  }
});
