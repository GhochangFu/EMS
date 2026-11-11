import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../../testing/seeded-subjects";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertCreateIsAuditedAndRefusesDuplicates,
  assertEveryRouteIsTheGlobalAdmins,
  assertRevokeIsFinalAndUnassigns,
  assertTheAssignmentRules,
  assertTheMintStoresOnlyTheHash,
  assertUpdateRenamesAndMoves,
  type EdgeGatewayFixtures,
} from "./edge-gateways.integration.spec";
import { EdgeGatewaysAdminService } from "./edge-gateways.service";

/**
 * `E7.2` (plan T6.2) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The service reads
 * and writes on `bms_fleet` (the gate's default connection, BYPASSRLS, the pool
 * the API's `FLEET_DRIZZLE` is), access control reads `bms.users` on
 * `bms_auth`, and the audit service holds the tenant and fleet pools.
 *
 * Fixtures: in the seeded organization admin's organization, six RTUs (two the
 * edge may serve, one with no `rtu_code`, one `modbus_tcp`, one whose asset the
 * simulator feeds) and one RTU in another organization; two assets. Every code
 * carries the run's `e72gw-<stamp>`; cleanup is by the ids created, never a
 * prefix sweep (`tests/integration-fixture-isolation`).
 */
const connectionString = requireIntegrationDb({
  item: "E7.2",
  label: "the edge gateway admin (mint, revoke, RTU assignment)",
  because:
    "the global-admin gate on every route, the SHA-256 the table holds after a mint, the token " +
    "absent from every audit payload, the RTUs unassigned by revoke and the assets.meta left " +
    "unchanged by an assignment are all claims about rows Postgres holds; a green run without a " +
    "database asserts none of them.",
});

describe.skipIf(!connectionString)("E7.2 — the edge gateway admin service", () => {
  let observer: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: EdgeGatewayFixtures;
  let admin: JwtPayload;
  let refused: JwtPayload[];
  // Per run: a concurrent instance of this file never shares a fixture code.
  const stamp = randomUUID().slice(0, 8);
  const rtuIds: string[] = [];
  const assetIds: string[] = [];
  const gatewayIds: string[] = [];
  const organizationIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    observer = await openIntegrationPool(url, "E7.2");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E7.2");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.2",
    );
    await primeSeededSubjects(observer);
    admin = jwtFor(SEEDED.globalAdmin, "admin");
    refused = [jwtFor(SEEDED.organizationAdmin, "organization_admin"), jwtFor(SEEDED.locationAdmin, "location_admin")];

    const { rows: org } = await observer.query<{ id: string }>(
      `SELECT o.id FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
         JOIN bms.organizations o ON o.id = uoa.organization_id
        WHERE u.email = $1 LIMIT 1`,
      [SEEDED.organizationAdmin],
    );
    if (!org[0]) throw new Error(`E7.2: ${SEEDED.organizationAdmin} has no organization grant — run pnpm db:seed.`);
    const organizationId = org[0].id;
    const locationOf = async (orgId: string): Promise<string> => {
      const { rows } = await observer.query<{ id: string }>(
        "SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1",
        [orgId],
      );
      if (!rows[0]) throw new Error("E7.2: an organization has no active location — run pnpm db:seed.");
      return rows[0].id;
    };
    const locationId = await locationOf(organizationId);
    const { rows: other } = await observer.query<{ id: string }>(
      `SELECT o.id FROM bms.organizations o
        WHERE o.id <> $1 AND EXISTS (SELECT 1 FROM bms.locations l WHERE l.organization_id = o.id AND l.active = true)
        ORDER BY o.code LIMIT 1`,
      [organizationId],
    );
    if (!other[0]) throw new Error("E7.2: no second organization with an active location — run pnpm db:seed.");
    const foreignOrganizationId = other[0].id;
    const foreignLocationId = await locationOf(foreignOrganizationId);
    const { rows: dom } = await observer.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1",
    );
    if (!dom[0]) throw new Error("E7.2: no active asset_domain — run pnpm db:seed.");

    const rtu = async (
      suffix: string,
      opts: {
        orgId?: string;
        locId?: string;
        sourceType?: string;
        rtuCode?: boolean;
        protocol?: string;
        active?: boolean;
        ingestEnabled?: boolean;
      } = {},
    ): Promise<string> => {
      const code = `e72gw-${stamp}-${suffix}`;
      const orgId = opts.orgId ?? organizationId;
      const { rows } = await observer.query<{ id: string }>(
        `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type, rtu_code, ingest_enabled, active)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7) RETURNING id`,
        [
          orgId,
          opts.locId ?? locationId,
          code,
          opts.sourceType ?? "mqtt",
          opts.rtuCode === false ? null : code,
          opts.ingestEnabled ?? true,
          opts.active ?? true,
        ],
      );
      const id = rows[0]!.id;
      rtuIds.push(id);
      if (opts.protocol !== undefined) {
        await observer.query(
          `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config) VALUES ($1, $2, $3, '{}'::jsonb)`,
          [orgId, id, opts.protocol],
        );
      }
      return id;
    };
    const asset = async (suffix: string, rtuId: string, telemetrySource: string): Promise<string> => {
      const { rows } = await observer.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, rtu_id, domain, meta)
         VALUES ($1, $2, $2, 'E7.2 site', $3, $4, $5, $6::jsonb) RETURNING id`,
        [organizationId, `e72gw-${stamp}-${suffix}`, locationId, rtuId, dom[0]!.code, JSON.stringify({ telemetrySource })],
      );
      const id = rows[0]!.id;
      assetIds.push(id);
      return id;
    };

    const ok1 = await rtu("ok1");
    const ok2 = await rtu("ok2");
    const noCode = await rtu("nocode", { rtuCode: false });
    const modbus = await rtu("modbus", { sourceType: "catalog", protocol: "modbus_tcp" });
    const simulatorFed = await rtu("simfed");
    const foreign = await rtu("foreign", { orgId: foreignOrganizationId, locId: foreignLocationId });
    const inactive = await rtu("inactive", { active: false });
    const ingestOff = await rtu("ingestoff", { ingestEnabled: false });

    // A run-owned organization with its ingest switch off (the F4.330 fixture shape), one location
    // and one RTU, so the seeded organizations' switches are never touched.
    const offCode = `E72GW-${stamp.toUpperCase()}-OFF`;
    const { rows: offOrg } = await observer.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency, ingest_enabled) VALUES ($1, 'E7.2 ingest-off fixture', 'INR', false) RETURNING id",
      [offCode],
    );
    const offOrganizationId = offOrg[0]!.id;
    organizationIds.push(offOrganizationId);
    const { rows: offLoc } = await observer.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, 'E7.2 ingest-off fixture site', (SELECT code FROM bms.location_types ORDER BY code LIMIT 1), 0, 0)
       RETURNING id`,
      [offOrganizationId, `${offCode}-LOC`, `${offCode}-loc`.toLowerCase()],
    );
    const offRtu = await rtu("off-rtu", { orgId: offOrganizationId, locId: offLoc[0]!.id });
    const ok1AssetId = await asset("ok1-asset", ok1, "mqtt");
    await asset("simfed-asset", simulatorFed, "catalog");

    const fleetDb = createDb(observer);
    const tenantDb = createDb(tenantPool);
    ctx = {
      svc: new EdgeGatewaysAdminService(
        fleetDb,
        new AccessControlService(createDb(authPool), fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
      ),
      observer,
      stamp,
      organizationId,
      locationId,
      foreignLocationId,
      rtus: { ok1, ok2, noCode, modbus, simulatorFed, foreign, inactive, ingestOff },
      switchedOff: { organizationId: offOrganizationId, rtuId: offRtu },
      ok1AssetId,
      gatewayIds,
    };
  }, 60_000);

  afterAll(async () => {
    if (observer) {
      // Assets, then RTUs (they reference the gateways; their connection rows cascade), then the
      // gateways and their audit rows.
      await observer.query("DELETE FROM bms.assets WHERE id = ANY($1::uuid[])", [assetIds]);
      await observer.query("DELETE FROM bms.rtus WHERE id = ANY($1::uuid[])", [rtuIds]);
      await observer.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])", [gatewayIds]);
      await observer.query("DELETE FROM bms.edge_gateways WHERE id = ANY($1::uuid[])", [gatewayIds]);
      // The run's ingest-off organization last: its location, then itself.
      await observer.query("DELETE FROM bms.locations WHERE organization_id = ANY($1::uuid[])", [organizationIds]);
      await observer.query("DELETE FROM bms.organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
    }
    await Promise.all([observer?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  it("I1 refuses an organization admin and a location admin every route, the read included", async () => {
    await assertEveryRouteIsTheGlobalAdmins(ctx, admin, refused);
  });

  it("I2 audits a create as a platform row and refuses a duplicate code (409) and a foreign location (404)", async () => {
    await assertCreateIsAuditedAndRefusesDuplicates(ctx, admin);
  });

  it("I3 renames and moves a gateway and refuses an empty patch", async () => {
    await assertUpdateRenamesAndMoves(ctx, admin);
  });

  it("I4 mints a token once, stores only its SHA-256, and a second mint replaces it", async () => {
    await assertTheMintStoresOnlyTheHash(ctx, admin);
  });

  it("I5 assigns only eligible RTUs of the gateway's organization and leaves assets.meta alone", async () => {
    await assertTheAssignmentRules(ctx, admin);
  });

  it("I6 keeps revoke final and unassigns the gateway's RTUs", async () => {
    await assertRevokeIsFinalAndUnassigns(ctx, admin);
  });
});
