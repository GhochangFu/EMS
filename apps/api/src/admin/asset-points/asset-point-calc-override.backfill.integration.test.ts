import { randomUUID } from "node:crypto";

import type pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcBackfillRunStore } from "../../calc-backfill/calc-backfill-run-store";
import { CalcDefinitionsService } from "../../calc/calc-definitions.service";
import { CalcDependencyService } from "../../calc/calc-dependency.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { CalcScopeService } from "../../calc/calc-scope.service";
import { CalcStatusRegistry } from "../../calc/calc-status.registry";
import { MetricsService } from "../../observability/metrics.service";
import { calcBackfillQueue } from "../../queue/calc-backfill";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import {
  openIntegrationQueueClient,
  requireIntegrationRedis,
  type IntegrationQueueClient,
} from "../../testing/integration-redis-gate";
import { asRole } from "../../testing/role-urls";
import { loadFixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertAnOverridePutCreatesAQueuedRunOnTheSavedRow,
  assertAnOverridePutWithoutBackfillDaysStartsNoRun,
  assertASecondOverrideBackfillIs409,
  assertTheOverride409StillSavedTheColumns,
  assertTheOverrideRunsJobIsEnqueued,
  cleanup,
  DERIVED_KEY,
  MEASURED_KEY,
  type OverrideBackfillSuite,
} from "./asset-point-calc-override.backfill.integration.spec";
import { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";
import { CalcBackfillRequestService } from "./calc-backfill-request.service";

/**
 * `F4.311` PR 5 review — Vitest entry point for `backfillDays` on the
 * override `PUT`. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the pools and the queue client, both gated as the standalone
 * sibling's are.
 */
const connectionString = requireIntegrationDb({
  item: "F4.311",
  label: "override calc point backfill tests",
  because:
    "the override's 409 that leaves its columns saved is a partial unique index and two transactions — " +
    "only a database shows that the override survived the refused run.",
});
const redisUrl = requireIntegrationRedis({
  item: "F4.311",
  label: "override calc point backfill tests",
  because: "the run's job must be in Redis under its own job id, which no fake can show.",
});

describe.skipIf(!connectionString || !redisUrl)("F4.311 — backfillDays on the override PUT (owner rulings 1 and 4)", () => {
  let suite: OverrideBackfillSuite | undefined;
  let tenantPool: pg.Pool | undefined;
  let queueClient: IntegrationQueueClient | undefined;
  let releasePointKeys: (() => Promise<void>) | undefined;

  const run = (claim: (suite: OverrideBackfillSuite) => Promise<void>) => async () => {
    if (!suite) throw new Error("suite required");
    await claim(suite);
  };

  beforeAll(async () => {
    const pool = await openIntegrationPool(connectionString as string, "F4.311");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(connectionString as string, "bms_tenant", "bms_tenant_dev"),
      "F4.311",
    );
    releasePointKeys = await registerFixturePointKeys(pool, [MEASURED_KEY, DERIVED_KEY]);
    queueClient = await openIntegrationQueueClient(
      redisUrl as string,
      "F4.311",
      [calcBackfillQueue],
      `bms-f4311-ovr-${randomUUID().slice(0, 8)}`,
    );
    const db = createDb(pool);
    const tenantDb = createDb(tenantPool);
    const svc = new AssetPointCalcOverrideService(
      db,
      db,
      new AccessControlService(db, db),
      new MasterDataAuditService(db, db),
      new CalcDependencyService(db, new CalcDefinitionsService(db, new MetricsService()), new CalcScopeService(db)),
      new CalcParametersService(db),
      new CalcStatusRegistry(),
      new CalcBackfillRequestService(tenantDb, queueClient.client, new CalcBackfillRunStore(tenantDb, db)),
    );
    const queue = queueClient.queues.get(calcBackfillQueue.name);
    if (!queue) throw new Error("the calc-backfill queue was not opened");
    suite = { pool, svc, fx: await loadFixtures(pool), queue };
    await cleanup(pool);
  });

  afterAll(async () => {
    if (suite) {
      await cleanup(suite.pool);
      await releasePointKeys?.();
      await suite.pool.end();
    }
    await tenantPool?.end();
    if (queueClient) {
      for (const queue of queueClient.queues.values()) {
        await queue.obliterate({ force: true });
      }
      await queueClient.client.close();
    }
  });

  beforeEach(async () => {
    if (suite) await cleanup(suite.pool);
  });

  it("creates one queued seven-day run on the saved row", run(assertAnOverridePutCreatesAQueuedRunOnTheSavedRow));
  it("enqueues the override run's job under calc-backfill-<runId>", run(assertTheOverrideRunsJobIsEnqueued));
  it("answers 409 for a second backfill while the first is queued", run(assertASecondOverrideBackfillIs409));
  it("still stores the override's columns on that 409 (ruling 4)", run(assertTheOverride409StillSavedTheColumns));
  it("starts no run without backfillDays", run(assertAnOverridePutWithoutBackfillDaysStartsNoRun));
});
