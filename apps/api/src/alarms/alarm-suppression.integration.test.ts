import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertCoveredRaiseIsStampedAndSilent,
  assertCoverFailureRollsTheRaiseBack,
  assertTwinRaiseNotifiesOnce,
  type Engine,
  type GapOutcome,
  type OneTransactionFixture,
  runGapScenario,
} from "./alarm-suppression.integration.spec";
import { dropCoverOrganization, insertCoverOrganization, insertWindow } from "./maintenance-cover.reads.integration.spec";

/**
 * `F4.359` U7 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools and the committed organization of the
 * one-transaction test. Each engine's scenario runs once in its `beforeAll`
 * and each claim is its own `it()`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.359",
  label: "the raise path suppresses notifications inside a maintenance window",
  because:
    "a notification leak is the defect this row exists to prevent: only a real database proves that each of " +
    "the three rule engines leaves no delivery row for a suppressed raise, and that the stamp shares the " +
    "insert's transaction with its NOTIFY.",
});

const SCENARIO_TIMEOUT_MS = 60_000;
const ENGINES: readonly Engine[] = ["streaming", "evaluate-now", "rule-sweep"];

describe.skipIf(!connectionString)("F4.359 U7 — suppression on the raise path", () => {
  let pools: pg.Pool[] = [];
  let admin: pg.Pool;
  let oneTx: OneTransactionFixture | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    admin = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.359");
    const tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.359");
    pools = [admin, tenantPool];
    const org = await insertCoverOrganization(admin, "ONETX");
    await insertWindow(admin, org, { startsInSeconds: -60, endsInSeconds: 3600, assetIds: [org.assetIds[0]] });
    oneTx = { admin, tenantDb: createDb(tenantPool), org };
  });

  afterAll(async () => {
    if (oneTx) await dropCoverOrganization(admin, oneTx.org.organizationId);
    await Promise.all(pools.map((pool) => pool.end()));
  });

  for (const engine of ENGINES) {
    describe(`the gap test — ${engine}`, () => {
      let outcome: GapOutcome;
      beforeAll(async () => {
        outcome = await runGapScenario(createDb(admin), engine);
      }, SCENARIO_TIMEOUT_MS);

      it("a raise inside the window is stamped and leaves zero notification_deliveries rows", () => {
        assertCoveredRaiseIsStampedAndSilent(outcome, engine);
      });

      it("the same raise with no window leaves one sent row (the positive twin)", () => {
        assertTwinRaiseNotifiesOnce(outcome, engine);
      });
    });
  }

  it("the one-transaction test: a failing cover read leaves no alarm row and delivers no NOTIFY", async () => {
    if (!oneTx) throw new Error("F4.359: the one-transaction fixture was not built");
    await assertCoverFailureRollsTheRaiseBack(oneTx);
  });
});
