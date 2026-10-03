import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import {
  aConcurrentFirstSaveKeepsTheOtherSavesKey,
  aHalfKeyIsRefused,
  aModelOnlySaveAfterADeleteStoresNoKey,
  aModelOnlySaveKeepsAKeyRotatedWhileItWaited,
  aProviderChangeWhileItWaitedClearsTheKeyAndSaysSo,
  aProviderWithoutAModelIsRefused,
  aTenantCannotReadAnotherOrganizationsRow,
  aTenantCannotWriteAnotherOrganizationsRow,
  aTenantWritesItsOwnRow,
  anUnknownProviderIsRefused,
  deletingTheOrganizationCascades,
  type LlmSettingsCtx,
} from "./organization-llm-settings.rls.integration.spec";

/**
 * `F3.21` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools, the two scratch organizations and
 * their cleanup, on the `organizations.currency.integration.test.ts` harness.
 *
 * Two organizations in a per-run code family (`F321-LLM-<run>-A`/`-B`), each
 * registered the moment it exists and deleted in `afterAll` (the cascade
 * removes their settings rows). A stale sweep bounded by `created_at` reaps a
 * run that died before its `afterAll`.
 */
const connectionString = requireIntegrationDb({
  item: "F3.21",
  label: "bms.organization_llm_settings row-level security and CHECKs",
  because:
    "the table holds every organization's encrypted LLM API key; only a real database can show " +
    "that FORCE + the tenant policy keep one organization from reading or writing another's row, " +
    "and that the three CHECKs refuse an unknown provider, a missing model and a half-stored key.",
  connection: "owner",
});

/** Per-run family; every organization this suite writes carries it. */
const FAMILY = `F321-LLM-${Date.now()}`;
/** The family every run shares, for the stale sweep. */
const FAMILY_PATTERN = "F321-LLM-%";

async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`,
      [FAMILY_PATTERN],
    );
  } catch (err) {
    process.stderr.write(
      `[F3.21] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

describe.skipIf(!connectionString)("F3.21 — bms.organization_llm_settings (migration 0100)", () => {
  let ownerPool: pg.Pool;
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: LlmSettingsCtx;
  const createdIds: string[] = [];

  async function createOrganization(suffix: string): Promise<string> {
    const { rows } = await fleetPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id",
      [`${FAMILY}-${suffix}`, `F3.21 LLM settings ${suffix}`],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`F3.21: fixture organization ${suffix} was not created`);
    createdIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F3.21");
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.21",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.21",
    );

    await sweepStaleRuns(fleetPool);

    ctx = {
      tenantDb: createDb(tenantPool),
      fleetPool,
      ownerPool,
      orgA: await createOrganization("A"),
      orgB: await createOrganization("B"),
    };
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await fleetPool.query(
        "DELETE FROM bms.organization_llm_settings WHERE organization_id = ANY($1)",
        [createdIds],
      );
      await fleetPool.query("DELETE FROM bms.organizations WHERE id = ANY($1)", [createdIds]);
    }
    await Promise.all([ownerPool?.end(), fleetPool?.end(), tenantPool?.end()]);
  });

  it("aTenantWritesItsOwnRow", async () => {
    await aTenantWritesItsOwnRow(ctx);
  });

  it("aTenantCannotReadAnotherOrganizationsRow", async () => {
    await aTenantCannotReadAnotherOrganizationsRow(ctx);
  });

  it("aTenantCannotWriteAnotherOrganizationsRow", async () => {
    await aTenantCannotWriteAnotherOrganizationsRow(ctx);
  });

  it("anUnknownProviderIsRefused", async () => {
    await anUnknownProviderIsRefused(ctx);
  });

  it("aProviderWithoutAModelIsRefused", async () => {
    await aProviderWithoutAModelIsRefused(ctx);
  });

  it("aHalfKeyIsRefused", async () => {
    await aHalfKeyIsRefused(ctx);
  });

  it("deletingTheOrganizationCascades", async () => {
    await deletingTheOrganizationCascades(ctx);
  });

  // The three lock-race cases poll up to BLOCK_WAIT_MS for put() to block, so
  // each gets more than the 5 s default.
  it("aModelOnlySaveKeepsAKeyRotatedWhileItWaited", { timeout: 15_000 }, async () => {
    await aModelOnlySaveKeepsAKeyRotatedWhileItWaited(ctx);
  });

  it("aModelOnlySaveAfterADeleteStoresNoKey", { timeout: 15_000 }, async () => {
    await aModelOnlySaveAfterADeleteStoresNoKey(ctx);
  });

  it("aProviderChangeWhileItWaitedClearsTheKeyAndSaysSo", { timeout: 15_000 }, async () => {
    await aProviderChangeWhileItWaitedClearsTheKeyAndSaysSo(ctx);
  });

  it("aConcurrentFirstSaveKeepsTheOtherSavesKey", { timeout: 15_000 }, async () => {
    await aConcurrentFirstSaveKeepsTheOtherSavesKey(ctx);
  });
});
