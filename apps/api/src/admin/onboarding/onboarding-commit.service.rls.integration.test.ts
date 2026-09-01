import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import {
  assertCommitRefusesAContradictingPointKey,
  assertCommitStampsOrgOnEveryTenantRow,
  type CommitConflictFixtures,
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

// ADR 0051 Amendment 1 — a second draft, on its own codes so neither test can
// leave the other a row it did not expect. `SHARED_POINT_KEY_CODE` is
// registered in the catalog before the run with no unit, which is the
// decision 3 case: the draft below declares one, and must be refused.
const CONFLICT_LOCATION_CODE = `E71B-OBX-${RUN}`;
const CONFLICT_LOCATION_SLUG = `e71b-obx-${RUN}`;
const CONFLICT_RTU_CODE = `E71B-OBX-RTU-${RUN}`;
const CONFLICT_ASSET_CODE = `E71B-OBX-AS-${RUN}`;
const SHARED_POINT_KEY_CODE = `E71B_OBX_SHARED_${RUN}`;

/** The distinct codes one draft writes, so two drafts never collide. */
type DraftCodes = {
  locationCode: string;
  locationSlug: string;
  rtuCode: string;
  assetCode: string;
  pointKeyCode: string;
  pointKeyUnit: string;
};

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

function commitReadyDraft(domain: string, codes: DraftCodes): OnboardingDraft {
  return {
    location: {
      code: codes.locationCode,
      slug: codes.locationSlug,
      name: "E7.1b Onboarding Location",
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [
      {
        code: codes.rtuCode,
        displayName: "E7.1b Onboarding RTU",
        protocol: "simulator",
        config: {},
      },
    ],
    pointKeys: [
      {
        code: codes.pointKeyCode,
        name: "E7.1b Onboarding Point Key",
        unit: codes.pointKeyUnit,
      },
    ],
    assets: [
      {
        rtuIndex: 0,
        code: codes.assetCode,
        name: "E7.1b Onboarding Asset",
        siteName: "E7.1b Site",
        domain,
      },
    ],
    assetPoints: [
      {
        assetIndex: 0,
        pointKey: codes.pointKeyCode,
        sourceDataKey: "E71B/OB/RAW",
      },
    ],
  } as OnboardingDraft;
}

const STAMPING_CODES: DraftCodes = {
  locationCode: LOCATION_CODE,
  locationSlug: LOCATION_SLUG,
  rtuCode: RTU_CODE,
  assetCode: ASSET_CODE,
  pointKeyCode: POINT_KEY_CODE,
  pointKeyUnit: "kW",
};

const CONFLICT_CODES: DraftCodes = {
  locationCode: CONFLICT_LOCATION_CODE,
  locationSlug: CONFLICT_LOCATION_SLUG,
  rtuCode: CONFLICT_RTU_CODE,
  assetCode: CONFLICT_ASSET_CODE,
  pointKeyCode: SHARED_POINT_KEY_CODE,
  pointKeyUnit: "kW",
};

describe.skipIf(!connectionString)("E7.1b — onboarding commit stamps org under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: CommitRlsFixtures;
  let conflictCtx: CommitConflictFixtures;
  let sessionId = "";
  let conflictSessionId = "";
  let removeSharedPointKey: (() => Promise<void>) | undefined;
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

    // Seed each draft session through bms_tenant. onboarding_sessions is
    // policied (FORCE since 0040), so the GUC = org is what lets the insert's
    // WITH CHECK pass — the same tenant boundary the commit itself runs under.
    const seedSession = async (draft: OnboardingDraft): Promise<string> =>
      withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({
            organizationId,
            status: "draft",
            currentPhase: "review",
            draft,
          })
          .returning({ id: onboardingSessions.id });
        return row.id;
      });

    sessionId = await seedSession(commitReadyDraft(domain, STAMPING_CODES));
    conflictSessionId = await seedSession(commitReadyDraft(domain, CONFLICT_CODES));

    // The catalog row the second draft contradicts. `registerFixturePointKeys`
    // writes `(code, name, active)` only, so the unit is NULL — Amendment 1
    // decision 3's case, and the one the four seeded orphans are in.
    removeSharedPointKey = await registerFixturePointKeys(ownerPool, [SHARED_POINT_KEY_CODE]);

    const commitSvc = new OnboardingCommitService(
      fleetDb,
      tenantDb,
      new AccessControlService(authDb, fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new OnboardingValidateService(),
      new VocabulariesService(fleetDb),
    );

    ctx = { commitSvc, ownerPool, organizationId, sessionId };
    conflictCtx = {
      commitSvc,
      ownerPool,
      sessionId: conflictSessionId,
      pointKeyCode: SHARED_POINT_KEY_CODE,
      locationCode: CONFLICT_LOCATION_CODE,
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
      // Both sessions, unconditionally: the conflict draft never commits, so it
      // leaves nothing but its own row, and `committed` says nothing about it.
      const sessionIds = [sessionId, conflictSessionId].filter(Boolean);
      if (sessionIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)`, [
          sessionIds,
        ]);
      }
    }
    // Everything below is outside the `if (committed)` bracket on purpose, and
    // is keyed by this run's codes rather than by ids a commit returned.
    //
    // The second test asserts a **refusal**, so on a green run its draft writes
    // nothing and these statements delete nothing. The run that matters is the
    // red one: if the guard ever regresses, that draft commits a whole estate
    // into PHEWB and no `committed` value names it. A leftover `E71B-OB*`
    // location is what makes `compose up`'s seed verifier fail on the next run,
    // several sessions later, with a row count and no cause.
    if (ownerPool) {
      const strays = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.assets WHERE code = $1`,
        [CONFLICT_ASSET_CODE],
      );
      const strayAssetIds = strays.rows.map((r) => r.id);
      if (strayAssetIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1)`, [
          strayAssetIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.asset_group_members WHERE asset_id = ANY($1)`, [
          strayAssetIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [strayAssetIds]);
      }
      const strayRtus = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.rtus WHERE code = $1`,
        [CONFLICT_RTU_CODE],
      );
      const strayRtuIds = strayRtus.rows.map((r) => r.id);
      if (strayRtuIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [
          strayRtuIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [strayRtuIds]);
      }
      const strayLocations = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE code = $1`,
        [CONFLICT_LOCATION_CODE],
      );
      const strayLocationIds = strayLocations.rows.map((r) => r.id);
      if (strayLocationIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
          strayLocationIds,
        ]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = ANY($1)`, [strayLocationIds]);
      }
    }
    // Last, because the asset_points above reference it (migration `0057`).
    // This row is inserted in `beforeAll`, not by a commit, so no `committed`
    // id would ever reach it.
    if (removeSharedPointKey) {
      await removeSharedPointKey();
    }
    await Promise.all(
      [ownerPool, authPool, tenantPool, fleetPool].filter(Boolean).map((p) => p.end()),
    );
  });

  it("stamps the session org on the location, point keys, RTUs, assets and asset points", async () => {
    committed = await assertCommitStampsOrgOnEveryTenantRow(ctx, jwt);
  });

  it("refuses a draft that contradicts a point key the whole fleet shares", async () => {
    await assertCommitRefusesAContradictingPointKey(conflictCtx, jwt);
  });
});
