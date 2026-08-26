import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import {
  assertCommitStampsOrgOnEveryTenantRow,
  type CommitIds,
  type CommitRlsFixtures,
} from "./onboarding-commit.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds one commit-ready
 * draft, runs the wizard's real commit against real `bms_auth`/`bms_tenant`/
 * `bms_fleet` connections, and proves every tenant-bearing row it writes is
 * stamped with the session's organization.
 *
 * The draft uses a `simulator` RTU on purpose: it exercises the same
 * `rtus`/`assets`/`asset_points` write path without needing an MQTT topic, MQTT
 * credentials or a configured `CREDENTIAL_ENCRYPTION_KEY`, so the org-stamping
 * proof stands on its own.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "onboarding commit stamps org on every tenant-bearing row it writes",
  because:
    "OnboardingCommitService.commit writes a whole estate — location, point keys, RTUs, RTU " +
    "connection configs, assets and asset points — in one withTenant transaction. rtus, assets " +
    "and asset_points gained organization_id in 0046 and a FORCEd policy in 0047; constructing " +
    "the service with real bms_tenant/bms_fleet connections is the only proof their inserts stamp " +
    "the org rather than passing because the owner connection bypasses row-level security.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000006";

const RUN = Date.now();
const LOCATION_CODE = `E71B-OB-${RUN}`;
const LOCATION_SLUG = `e71b-ob-${RUN}`;
const RTU_CODE = `E71B-OB-RTU-${RUN}`;
const ASSET_CODE = `E71B-OB-AS-${RUN}`;
const POINT_KEY_CODE = `E71B_OB_PK_${RUN}`;

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

function commitReadyDraft(domain: string): OnboardingDraft {
  return {
    location: {
      code: LOCATION_CODE,
      slug: LOCATION_SLUG,
      name: "E7.1b Onboarding Location",
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [
      {
        code: RTU_CODE,
        displayName: "E7.1b Onboarding RTU",
        protocol: "simulator",
        config: {},
      },
    ],
    pointKeys: [
      {
        code: POINT_KEY_CODE,
        name: "E7.1b Onboarding Point Key",
        unit: "kW",
      },
    ],
    assets: [
      {
        rtuIndex: 0,
        code: ASSET_CODE,
        name: "E7.1b Onboarding Asset",
        siteName: "E7.1b Site",
        domain,
      },
    ],
    assetPoints: [
      {
        assetIndex: 0,
        pointKey: POINT_KEY_CODE,
        sourceDataKey: "E71B/OB/RAW",
      },
    ],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("E7.1b — onboarding commit stamps org under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: CommitRlsFixtures;
  let sessionId = "";
  let committed: CommitIds | undefined;

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E7.1b",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E7.1b",
    );

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(
        `E7.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }
    const organizationId = org.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);

    // Seed the draft session through bms_tenant. onboarding_sessions is policied
    // (FORCE since 0040), so the GUC = org is what lets the insert's WITH CHECK
    // pass — the same tenant boundary the commit itself runs under.
    await withTenant(tenantDb, organizationId, async (tx) => {
      const [row] = await tx
        .insert(onboardingSessions)
        .values({
          organizationId,
          status: "draft",
          currentPhase: "review",
          draft: commitReadyDraft(domain),
        })
        .returning({ id: onboardingSessions.id });
      sessionId = row.id;
    });

    ctx = {
      commitSvc: new OnboardingCommitService(
        fleetDb,
        tenantDb,
        new AccessControlService(authDb, fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
        new OnboardingValidateService(),
        new VocabulariesService(fleetDb),
      ),
      ownerPool,
      organizationId,
      sessionId,
    };
  });

  afterAll(async () => {
    // children first, on the BYPASSRLS fleet connection. Delete by the ids the
    // commit returned; the session row is removed by its own id regardless.
    if (ownerPool) {
      if (committed) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
          [sessionId, committed.locationId],
        ]);
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [
          committed.assetPointIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [committed.assetIds]);
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [
          committed.rtuIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [committed.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [
          committed.pointKeyIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [committed.locationId]);
      }
      if (sessionId) {
        await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = $1`, [sessionId]);
      }
    }
    await Promise.all(
      [ownerPool, authPool, tenantPool, fleetPool].filter(Boolean).map((p) => p.end()),
    );
  });

  it("stamps the session org on the location, point keys, RTUs, assets and asset points", async () => {
    committed = await assertCommitStampsOrgOnEveryTenantRow(ctx, jwt);
  });
});
