import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import {
  assertAssetRowsCarryTheirTemplateAndRtu,
  assertAssetsListOnlyTheSessionOrganization,
  assertInactiveRowsAreListedWithTheFlag,
  assertInUsePointKeysAreTenantScoped,
  assertJoinsNeverReadAnotherOrganizationsRows,
  assertLocationCodeFilterIsExact,
  assertLocationsListOnlyTheSessionOrganization,
  assertNoRowCarriesTheConfigOrMetaSentinel,
  assertResultKeysArePerKindAllowlists,
  assertRtuCountCountsEachLocationsRtus,
  assertRtusListOnlyTheSessionOrganization,
  assertSearchEscapesLikeWildcards,
  assertSearchIsACaseInsensitiveSubstringOnCodeAndName,
  assertTheCapAndTheTotal,
  type InventoryCtx,
} from "./onboarding-inventory.service.integration.spec";

/**
 * `F3.26` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the `bms_fleet` pool, on the
 * `organization-llm-settings.rls.integration.test.ts` harness. Every case
 * inserts its fixture inside a transaction it rolls back, so there is no
 * cleanup and no stale sweep here.
 */
const connectionString = requireIntegrationDb({
  item: "F3.26",
  label: "OnboardingInventoryService and listInUsePointKeys on a real database",
  because:
    "the inventory read runs on the BYPASSRLS fleet pool, so only a real database can show that " +
    "its organization predicate keeps another organization's locations, RTUs, assets and point " +
    "keys out, and that no row carries rtu_connection_configs.config or a meta column.",
  connection: "owner",
});

/** Per-run token, base 36: alphanumerics only, so no `_` or `%` reaches a code. */
const RUN = Date.now().toString(36);

describe.skipIf(!connectionString)("F3.26 — onboarding inventory reads (ADR 0095)", () => {
  let fleetPool: pg.Pool;
  let ctx: InventoryCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.26",
    );
    ctx = { fleetDb: createDb(fleetPool), run: RUN };
  });

  afterAll(async () => {
    await fleetPool?.end();
  });

  it("I1 assertLocationsListOnlyTheSessionOrganization", async () => {
    await assertLocationsListOnlyTheSessionOrganization(ctx);
  });

  it("I2 assertRtusListOnlyTheSessionOrganization", async () => {
    await assertRtusListOnlyTheSessionOrganization(ctx);
  });

  it("I3 assertAssetsListOnlyTheSessionOrganization", async () => {
    await assertAssetsListOnlyTheSessionOrganization(ctx);
  });

  it("I4 assertNoRowCarriesTheConfigOrMetaSentinel", async () => {
    await assertNoRowCarriesTheConfigOrMetaSentinel(ctx);
  });

  it("I5 assertResultKeysArePerKindAllowlists", async () => {
    await assertResultKeysArePerKindAllowlists(ctx);
  });

  it("I6 assertSearchIsACaseInsensitiveSubstringOnCodeAndName", async () => {
    await assertSearchIsACaseInsensitiveSubstringOnCodeAndName(ctx);
  });

  it("I7 assertSearchEscapesLikeWildcards", async () => {
    await assertSearchEscapesLikeWildcards(ctx);
  });

  it("I8 assertLocationCodeFilterIsExact", async () => {
    await assertLocationCodeFilterIsExact(ctx);
  });

  it("I9 assertTheCapAndTheTotal", { timeout: 15_000 }, async () => {
    await assertTheCapAndTheTotal(ctx);
  });

  it("I10 assertInactiveRowsAreListedWithTheFlag", async () => {
    await assertInactiveRowsAreListedWithTheFlag(ctx);
  });

  it("I11 assertInUsePointKeysAreTenantScoped", async () => {
    await assertInUsePointKeysAreTenantScoped(ctx);
  });

  it("I12 assertRtuCountCountsEachLocationsRtus", async () => {
    await assertRtuCountCountsEachLocationsRtus(ctx);
  });

  it("I13 assertAssetRowsCarryTheirTemplateAndRtu", async () => {
    await assertAssetRowsCarryTheirTemplateAndRtu(ctx);
  });

  it("I14 assertJoinsNeverReadAnotherOrganizationsRows", async () => {
    await assertJoinsNeverReadAnotherOrganizationsRows(ctx);
  });
});
