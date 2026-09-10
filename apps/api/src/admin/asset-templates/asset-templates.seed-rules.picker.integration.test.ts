import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AlarmRaiser } from "../../alarms/alarm-raise.service";
import { AccessControlService } from "../../auth/access-control.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { RulesService } from "../../rules/rules.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import { loadFixtures } from "./asset-templates.instantiate.integration.spec";
import { instantiateAssetsBodySchema } from "./asset-templates.schema";
import {
  assertJoinPredicateIsNotVacuous,
  cleanup,
  loadSeedFixtures,
  publishFixtureTemplate,
  type SeedFixtures,
  type Services,
} from "./asset-templates.seed-rules.integration.spec";
import {
  assertEveryOfferedKeyIsAcceptedAndOneOtherRefused,
  assertPickerOffersTheValidatorsUnion,
  assertTemplateKeysAreOrderedByDeclaredOrder,
} from "./asset-templates.seed-rules.picker.integration.spec";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `F3.49` / ADR 0058 Amendment 2 — Vitest entry point for the picker cases.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle.
 *
 * It is a second file rather than two more cases in
 * `asset-templates.seed-rules.integration.test.ts` because that suite's spec
 * sits near §4.5's 1000-line cap, and `tests/repo-invariants.test.ts` requires
 * a same-stem wrapper for every spec.
 *
 * **It copies that wrapper's lifecycle; it does not join it.** Vitest evaluates
 * each test file's module graph afresh, and `TEST_TEMPLATE_CODE` /
 * `TEST_ASSET_PREFIX` call `randomUUID()` at module scope, so this suite
 * publishes its own template under its own codes and neither `cleanup` can
 * reach the other's rows. That is why the `beforeAll` below calls
 * `assertJoinPredicateIsNotVacuous` and `publishFixtureTemplate` itself rather
 * than inheriting them: delete either as redundant and the union case passes on
 * the hard-coded map alone.
 */
const connectionString = requireIntegrationDb({
  item: "F3.49",
  label: "rule builder picker == validator tests",
  because:
    "the claim is that GET /rules/catalog offers exactly the set assertCompatiblePoint accepts, " +
    "and both halves reach template_points through a join the unit-level fake ignores — a green " +
    "run without a database would assert that the picker and the validator agree when neither " +
    "has read a row.",
});

describe.skipIf(!connectionString)("F3.49 — the picker offers what the validator accepts", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: Services;
  let fx: SeedFixtures;
  let template: AdminAssetTemplateDto;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F3.49");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.49",
    );
    // `max: 8` and the longer acquisition timeout, for the reason the `E2.4`
    // wrapper measured: publishing a template that carries alarms reaches
    // `VocabulariesService.list`, six `Promise.all` selects on this handle.
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.49",
      { max: 8, connectionTimeoutMillis: 20_000 },
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.49",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const access = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const vocabularies = new VocabulariesService(tenantDb);
    const instantiation = new AssetTemplateInstantiationService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
    );
    // Real pools for both halves of `RulesService`: `getBuilderCatalog` and
    // `updateRule` are the two things under test and both are database
    // behaviours. The last two slots are stand-ins that resolve rather than
    // `{}`, the shape `rules.service.spec.ts` uses.
    const alarmRaiser = {} as unknown as AlarmRaiser;
    const notifications = {
      dispatch: () => Promise.resolve([]),
    } as unknown as NotificationsService;
    svc = {
      templates: new AssetTemplatesAdminService(fleetDb, tenantDb, access, audit, vocabularies),
      rules: new RulesService(tenantDb, fleetDb, vocabularies, alarmRaiser, notifications),
      instantiate: (jwt, templateId, body) =>
        instantiation.instantiate(jwt, templateId, instantiateAssetsBodySchema.parse(body)),
    };
    fx = await loadSeedFixtures(created, await loadFixtures(created));
    // The three fixture keys must be outside the hard-coded map, or the union
    // case passes on the map alone and proves nothing about the template side.
    assertJoinPredicateIsNotVacuous(fx);
    await cleanup(created);
    template = await publishFixtureTemplate(svc, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("offers the union assertCompatiblePoint accepts, on both catalog branches", async () => {
    await assertPickerOffersTheValidatorsUnion(svc, fx, pool as pg.Pool, template.id);
  });

  it("accepts every offered key through updateRule, and refuses one it does not offer", async () => {
    await assertEveryOfferedKeyIsAcceptedAndOneOtherRefused(svc, fx, pool as pg.Pool, template.id);
  });

  // Last on purpose: it rewrites this suite's template so that declared order
  // and insertion order disagree, which is the only way the `asc(sort_order)`
  // leg can be observed at all. It restores the three `sort_order` values in a
  // `finally`. The `asc(point_key)` tie-break is held by
  // `tests/f3.49-picker-validator-single-source.test.ts` instead, for the
  // reason the spec's docblock measures.
  it("orders the template half by declared sort_order, not by insertion", async () => {
    await assertTemplateKeysAreOrderedByDeclaredOrder(svc, fx, pool as pg.Pool, template.id);
  });
});
