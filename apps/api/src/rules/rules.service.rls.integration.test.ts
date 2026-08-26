import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb } from "@bms/db";

import { AlarmRaiser } from "../alarms/alarm-raise.service";
import type { AlarmsGateway } from "../alarms/alarms.gateway";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
import { pointKeysForAsset } from "./rule-points";
import { RulesService } from "./rules.service";
import {
  assertAssetlessTimeWindowRefusedForAdmin,
  assertAssetlessTimeWindowRefusedForScoped,
  assertCreateStampsOrgAndActorUnderRealRls,
  type RulesRlsFixtures,
} from "./rules.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds one asset in a
 * real organization, then drives `RulesService.createDraft` with a real
 * `bms_tenant` connection: one threshold create that must stamp the rule's org
 * and resolve its actor, and two asset-less `time_window` creates that ruling 4
 * refuses (a global admin with no tenant, and a scoped actor 404'd before org
 * resolution).
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "RulesService.createDraft org stamping and ruling-4 refusal against real, non-owner roles",
  because:
    "createDraft is the rule-authoring write this unit tenant-wraps. automation_rules gains " +
    "organization_id (0046) and a FORCEd policy (0047). Constructing RulesService with a real " +
    "bms_tenant connection is the only proof it stamps automation_rules.org from the asset under " +
    "withTenant and lands a non-NULL audit actor from the pre-tenant fleetDb read — rather than " +
    "passing because the owner connection bypasses RLS — and that ruling 4 refuses an asset-less " +
    "time_window create instead of inserting a NULL org.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const GLOBAL_ADMIN_EMAIL = "admin@bms.local";

const RUN = Date.now();
const PREFIX = "E71B-RULE-";

function stubGateway(): AlarmsGateway {
  return { broadcastCreated: () => undefined } as unknown as AlarmsGateway;
}

describe.skipIf(!connectionString)("E7.1b — RulesService.createDraft under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: RulesRlsFixtures;
  const createdRuleIds: string[] = [];
  let assetId: string;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
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

    const loc = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true LIMIT 1",
      [organizationId],
    );
    if (!loc.rows[0]) {
      throw new Error(`E7.1b: ${ORGANIZATION_ADMIN_EMAIL}'s org has no active location — run pnpm db:seed.`);
    }
    const locationId = loc.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    // Seed on the fleet (BYPASSRLS) pool: assets are not policied until 0047, so
    // no GUC is needed to insert one. The createDraft under test is what must run
    // under a real bms_tenant connection.
    const fleetDb = createDb(ownerPool);
    const code = `${PREFIX}ASSET-${RUN}`;
    const [asset] = await fleetDb
      .insert(assets)
      .values({
        organizationId,
        code,
        name: `E7.1b rules RLS asset`,
        siteName: "E7.1b Site",
        locationId,
        domain,
        active: true,
      })
      .returning({ id: assets.id });
    assetId = asset.id;
    // A point compatible with the seeded (domain, code) — the fallback list is
    // never empty, so [0] always exists — so assertCompatiblePoint passes.
    const pointKey = pointKeysForAsset(domain, code)[0] as string;

    ctx = {
      service: new RulesService(
        createDb(tenantPool),
        fleetDb,
        new VocabulariesService(fleetDb),
        new AlarmRaiser(createDb(tenantPool), stubGateway()),
      ),
      ownerPool,
      organizationId,
      assetId,
      pointKey,
      scopedActor: {
        sub: "00000000-0000-4000-8000-0000000000a1",
        email: ORGANIZATION_ADMIN_EMAIL,
      },
      adminActor: {
        sub: "00000000-0000-4000-8000-0000000000a2",
        email: GLOBAL_ADMIN_EMAIL,
      },
      createdRuleIds,
    };
  });

  afterAll(async () => {
    if (ownerPool) {
      if (createdRuleIds.length > 0) {
        await ownerPool.query(
          `DELETE FROM bms.audit_log WHERE entity_type = 'automation_rule' AND entity_id = ANY($1)`,
          [createdRuleIds],
        );
        await ownerPool.query(`DELETE FROM bms.automation_rules WHERE id = ANY($1)`, [createdRuleIds]);
      }
      await ownerPool.query(`DELETE FROM bms.automation_rules WHERE code LIKE $1`, [`${PREFIX}%`]);
      if (assetId) {
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = $1`, [assetId]);
      }
    }
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((p) => p.end()));
  });

  it("stamps automation_rules.org from the asset and resolves a non-NULL audit actor", async () => {
    await assertCreateStampsOrgAndActorUnderRealRls(ctx, `${PREFIX}CREATE-${RUN}`);
  });

  it("refuses a global admin's asset-less time_window create (ruling 4), writing nothing", async () => {
    await assertAssetlessTimeWindowRefusedForAdmin(ctx, `${PREFIX}ADMINTW-${RUN}`);
  });

  it("404s a scoped actor's asset-less time_window create before org resolution", async () => {
    await assertAssetlessTimeWindowRefusedForScoped(ctx, `${PREFIX}SCOPEDTW-${RUN}`);
  });
});
