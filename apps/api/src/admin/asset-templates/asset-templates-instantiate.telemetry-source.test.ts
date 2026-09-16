import { describe, it } from "vitest";

import {
  assertTheDerivationReadsTheFlagOnTheTenantTransaction,
  assertTheRtuFlagIsNamedOnlyOnce,
} from "./asset-templates-instantiate.telemetry-source.spec";

/**
 * `F4.139` (second pass) — Vitest entry point for the instantiate source scan.
 * Assertions live in the sibling `.spec` (ADR 0014). No database: this pair is
 * the structural gate that stays armed on a run without `DATABASE_URL`, where
 * the integration suite skips.
 */
describe("F4.139 — instantiate reads the RTU flags on the tenant transaction", () => {
  // One claim per `it`: `expect` throws.
  it("names rtus.ingestEnabled exactly once", () => {
    assertTheRtuFlagIsNamedOnlyOnce();
  });

  it("reads that flag inside deriveTelemetrySource, on tx", () => {
    assertTheDerivationReadsTheFlagOnTheTenantTransaction();
  });
});
