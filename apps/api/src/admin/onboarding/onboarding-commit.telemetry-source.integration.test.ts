import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingCommitResponseDto, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import {
  assertDisabledMqttAssetGetsCatalog,
  assertEnabledMqttAssetGetsMqtt,
  assertEnabledMqttAssetKeepsItsOtherMetaKey,
  assertSimulatorAssetGetsExplicitCatalog,
  type OnboardingTelemetrySourceCtx,
} from "./onboarding-commit.telemetry-source.integration.spec";

/**
 * `F4.140` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. New pair, not the
 * `E7.1b` file: that file is 787 lines and the plan (`docs/plans/
 * f4.139-f4.140-telemetry-source-writers.md`, Task 3) says not to grow it.
 * Lifecycle copies `onboarding-commit.service.rls.integration.test.ts`'s
 * `seedSession` (`:406-418`) and its cleanup (`:540-563`): children first, by
 * the ids `commit()` returned, sessions by id.
 */
const connectionString = requireIntegrationDb({
  item: "F4.140",
  label: "OnboardingCommitService writes assets.meta.telemetrySource from the RTU it just inserted",
  because:
    "the derivation reads the RTU row and rtu_connection_configs inside the same " +
    "withTenant transaction that inserts the asset, so nothing outside a real " +
    "commit proves an onboarded asset ever gets an explicit telemetrySource " +
    "instead of the two-producer absence F4.140's Facts section records.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000007";

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

const RUN = Date.now();

type DraftCodes = {
  locationCode: string;
  locationSlug: string;
  rtuCode: string;
  assetCode: string;
  pointKeyCode: string;
};

const MQTT_ENABLED_CODES: DraftCodes = {
  locationCode: `F4140-LOC-EN-${RUN}`,
  locationSlug: `f4140-loc-en-${RUN}`,
  rtuCode: `F4140-RTU-EN-${RUN}`,
  assetCode: `F4140-AS-EN-${RUN}`,
  pointKeyCode: `F4140_PK_EN_${RUN}`,
};

const MQTT_DISABLED_CODES: DraftCodes = {
  locationCode: `F4140-LOC-DIS-${RUN}`,
  locationSlug: `f4140-loc-dis-${RUN}`,
  rtuCode: `F4140-RTU-DIS-${RUN}`,
  assetCode: `F4140-AS-DIS-${RUN}`,
  pointKeyCode: `F4140_PK_DIS_${RUN}`,
};

const SIMULATOR_CODES: DraftCodes = {
  locationCode: `F4140-LOC-SIM-${RUN}`,
  locationSlug: `f4140-loc-sim-${RUN}`,
  rtuCode: `F4140-RTU-SIM-${RUN}`,
  assetCode: `F4140-AS-SIM-${RUN}`,
  pointKeyCode: `F4140_PK_SIM_${RUN}`,
};

/**
 * One RTU, one point key, one asset, one asset point — the `commitReadyDraft`
 * shape (`onboarding-commit.service.rls.integration.test.ts:138-180`).
 */
function draftFor(
  domain: string,
  codes: DraftCodes,
  rtu: { protocol: "mqtt" | "simulator"; ingestEnabled?: boolean },
  assetMeta?: Record<string, unknown>,
): OnboardingDraft {
  return {
    location: {
      code: codes.locationCode,
      slug: codes.locationSlug,
      name: "F4.140 Onboarding Location",
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [
      {
        code: codes.rtuCode,
        displayName: "F4.140 Onboarding RTU",
        protocol: rtu.protocol,
        // draftRtuSchema requires an mqtt RTU to declare a topic.
        config: rtu.protocol === "mqtt" ? { topic: `F4140/${codes.rtuCode}` } : {},
        ingestEnabled: rtu.ingestEnabled,
        // OnboardingValidateService refuses readyToCommit for an
        // ingest-enabled mqtt RTU with no credentials declared.
        credentialsSet: rtu.protocol === "mqtt" ? true : undefined,
      },
    ],
    pointKeys: [
      {
        code: codes.pointKeyCode,
        name: "F4.140 Onboarding Point Key",
        unit: "kW",
      },
    ],
    assets: [
      {
        rtuIndex: 0,
        code: codes.assetCode,
        name: "F4.140 Onboarding Asset",
        siteName: "F4.140 Site",
        domain,
        meta: assetMeta,
      },
    ],
    assetPoints: [
      {
        assetIndex: 0,
        pointKey: codes.pointKeyCode,
        sourceDataKey: `F4140/OB/${codes.rtuCode}`,
      },
    ],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)(
  "F4.140 — OnboardingCommitService derives telemetrySource",
  () => {
    let ownerPool: pg.Pool;
    let authPool: pg.Pool;
    let tenantPool: pg.Pool;
    let fleetPool: pg.Pool;
    const ctx: OnboardingTelemetrySourceCtx = { ownerPool: undefined as unknown as pg.Pool, committed: {} };
    let mqttEnabledSessionId = "";
    let mqttDisabledSessionId = "";
    let simulatorSessionId = "";

    const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(url, "F4.140");
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F4.140",
      );
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F4.140",
      );
      fleetPool = await openIntegrationPool(
        process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
        "F4.140",
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
          `F4.140: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
        );
      }
      const organizationId = org.rows[0].id;

      const dom = await ownerPool.query<{ code: string }>(
        "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
      );
      if (!dom.rows[0]) {
        throw new Error("F4.140: no active asset_domain — run pnpm db:seed.");
      }
      const domain = dom.rows[0].code;

      const tenantDb = createDb(tenantPool);
      const fleetDb = createDb(fleetPool);
      const authDb = createDb(authPool);

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

      mqttEnabledSessionId = await seedSession(
        draftFor(domain, MQTT_ENABLED_CODES, { protocol: "mqtt", ingestEnabled: true }, {
          telemetryEnabled: "false",
        }),
      );
      mqttDisabledSessionId = await seedSession(
        draftFor(domain, MQTT_DISABLED_CODES, { protocol: "mqtt", ingestEnabled: false }),
      );
      simulatorSessionId = await seedSession(draftFor(domain, SIMULATOR_CODES, { protocol: "simulator" }));

      const commitSvc = new OnboardingCommitService(
        fleetDb,
        tenantDb,
        new AccessControlService(authDb, fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
        new OnboardingValidateService(),
        new VocabulariesService(fleetDb),
      );

      ctx.ownerPool = ownerPool;
      ctx.committed.mqttEnabled = await commitSvc.commit(jwt, mqttEnabledSessionId);
      ctx.committed.mqttDisabled = await commitSvc.commit(jwt, mqttDisabledSessionId);
      ctx.committed.simulator = await commitSvc.commit(jwt, simulatorSessionId);
    }, 60_000);

    afterAll(async () => {
      // children first, on the BYPASSRLS fleet connection. Delete by the ids
      // each commit returned; the session rows are removed by id regardless.
      const commits: (OnboardingCommitResponseDto | undefined)[] = [
        ctx.committed.mqttEnabled,
        ctx.committed.mqttDisabled,
        ctx.committed.simulator,
      ];
      if (ownerPool) {
        for (const committed of commits) {
          if (!committed) continue;
          await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
            [...committed.assetIds, committed.locationId],
          ]);
          await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [
            committed.assetPointIds,
          ]);
          await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [
            committed.assetIds,
          ]);
          await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [
            committed.rtuIds,
          ]);
          await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [committed.rtuIds]);
          await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [
            committed.pointKeyIds,
          ]);
          await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [committed.locationId]);
        }
        const sessionIds = [mqttEnabledSessionId, mqttDisabledSessionId, simulatorSessionId].filter(
          Boolean,
        );
        if (sessionIds.length > 0) {
          await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)`, [
            sessionIds,
          ]);
        }
      }
      await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
    }, 60_000);

    // One claim per `it`: `expect` throws, so a second claim in the same
    // block would never run on the first one's failure.
    it("O1 — an enabled mqtt RTU's onboarded asset is derived mqtt", async () => {
      await assertEnabledMqttAssetGetsMqtt(ctx);
    }, 30_000);

    it("O2 — O1's asset keeps its caller-supplied meta key", async () => {
      await assertEnabledMqttAssetKeepsItsOtherMetaKey(ctx);
    }, 30_000);

    it("O3 — a disabled mqtt RTU's onboarded asset is derived catalog", async () => {
      await assertDisabledMqttAssetGetsCatalog(ctx);
    }, 30_000);

    it("O4 — a simulator RTU's onboarded asset carries an explicit catalog", async () => {
      await assertSimulatorAssetGetsExplicitCatalog(ctx);
    }, 30_000);
  },
);
