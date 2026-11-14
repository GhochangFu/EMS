import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import {
  assertAKwhMonthMatchesTheGoldenBill,
  assertAMeasuredKvahMonthBills,
  assertAnAssetInheritsTheNearestMapping,
  assertBadRegistersAnswerAReason,
  assertKvahIsEstimatedFromPf,
  assertAMalformedVersionFailsOnlyItsTarget,
  assertVersionsAreDatedAndIsolated,
  cleanupBillFixture,
  seedBillFixture,
  type BillFixture,
} from "./energy-bill.integration.spec";

/** `F4.365` U4 — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
const connectionString = requireIntegrationDb({
  item: "F4.365",
  label: "the monthly energy bill",
  because: "the bill is register deltas over a local month, dated tariff versions and an organization-bounded fleet read.",
});

describe.skipIf(!connectionString)("F4.365 — the monthly energy bill (ADR 0134)", () => {
  let superuser: pg.Pool;
  let fleet: pg.Pool;
  let fx: BillFixture;

  beforeAll(async () => {
    const url = connectionString as string;
    superuser = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.365");
    fleet = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.365");
    await cleanupBillFixture(superuser);
    fx = await seedBillFixture(superuser);
  }, 120_000);

  afterAll(async () => {
    if (superuser) {
      await cleanupBillFixture(superuser, fx);
      await superuser.end();
    }
    await fleet?.end();
  }, 120_000);

  it("(a) bills a kWh month at the golden 2546.00", () => assertAKwhMonthMatchesTheGoldenBill(fleet, fx));
  it("(b) bills a measured kVAh month", () => assertAMeasuredKvahMonthBills(fleet, fx));
  it("(c, d) estimates kVAh from kWh ÷ pf, or answers kvah_unavailable", () => assertKvahIsEstimatedFromPf(fleet, fx));
  it("(e, f) answers meter_no_reading and meter_decreasing", () => assertBadRegistersAnswerAReason(fleet, fx));
  it("(g, h) serves dated organization versions, never another organization's", () => assertVersionsAreDatedAndIsolated(fleet, fx));
  it("prices a child location's asset at its nearest mapped ancestor", () => assertAnAssetInheritsTheNearestMapping(fleet, fx));
  it("fails a malformed version with version_invalid, target by target", () => assertAMalformedVersionFailsOnlyItsTarget(fleet, fx));
});
