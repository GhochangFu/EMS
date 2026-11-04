import { randomUUID } from "node:crypto";

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
import { loadFixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import { MasterDataAuditService } from "../master-data-audit.service";
import { CalcBackfillRequestService } from "./calc-backfill-request.service";
import {
  assertAPutCreatesAQueuedSevenDayRun,
  assertAPutWithoutBackfillDaysStartsNoRun,
  assertASecondBackfillWhileQueuedIs409,
  assertThe409StillSavedTheFormula,
  assertTheListShowsTheRunsStatus,
  assertTheRunsJobIsEnqueued,
  CALC_KEY,
  cleanup,
  MEASURED_KEY,
  type BackfillSuite,
} from "./calc-point-standalone.backfill.integration.spec";
import { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F4.311` PR 5b — Vitest entry point for `backfillDays` on the standalone
 * `PUT`. Assertions live in the sibling `.spec` (ADR 0014); this file owns
 * the database pool and the queue client, both gated: the run rows are
 * Postgres and the job is Redis, and a green run without either asserts
 * nothing about the split ruling 4 made.
 */
const connectionString = requireIntegrationDb({
  item: "F4.311",
  label: "standalone calc point backfill tests",
  because:
    "the 409 that leaves the formula saved is a partial unique index and two transactions — " +
    "only a database shows that the point write survived the refused run.",
});
const redisUrl = requireIntegrationRedis({
  item: "F4.311",
  label: "standalone calc point backfill tests",
  because: "the run's job must be in Redis under its own job id, which no fake can show.",
});

describe.skipIf(!connectionString || !redisUrl)("F4.311 — backfillDays on the standalone PUT (owner ruling 4)", () => {
  let suite: BackfillSuite | undefined;
  let queueClient: IntegrationQueueClient | undefined;
  let releasePointKeys: (() => Promise<void>) | undefined;

  const run = (claim: (suite: BackfillSuite) => Promise<void>) => async () => {
    if (!suite) throw new Error("suite required");
    await claim(suite);
  };

  beforeAll(async () => {
    const pool = await openIntegrationPool(connectionString as string, "F4.311");
    releasePointKeys = await registerFixturePointKeys(pool, [MEASURED_KEY, CALC_KEY]);
    // Its own prefix: a worker on the developer's stack never claims these jobs.
    queueClient = await openIntegrationQueueClient(
      redisUrl as string,
      "F4.311",
      [calcBackfillQueue],
      `bms-f4311-${randomUUID().slice(0, 8)}`,
    );
    const db = createDb(pool);
    const scope = new CalcScopeService(db);
    const svc = new CalcPointStandaloneService(
      db,
      db,
      new AccessControlService(db, db),
      new MasterDataAuditService(db, db),
      new CalcDependencyService(db, new CalcDefinitionsService(db, new MetricsService()), scope),
      new CalcParametersService(db),
      scope,
      new CalcStatusRegistry(),
      new CalcBackfillRequestService(db, queueClient.client, new CalcBackfillRunStore(db, db)),
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

  it("creates one queued seven-day run for backfillDays: 7", run(assertAPutCreatesAQueuedSevenDayRun));
  it("enqueues the run's job under calc-backfill-<runId>", run(assertTheRunsJobIsEnqueued));
  it("answers 409 for a second backfill while the first is queued", run(assertASecondBackfillWhileQueuedIs409));
  it("still saves the formula on that 409 (ruling 4)", run(assertThe409StillSavedTheFormula));
  it("shows the run's status on the list", run(assertTheListShowsTheRunsStatus));
  it("starts no run without backfillDays", run(assertAPutWithoutBackfillDaysStartsNoRun));
});
