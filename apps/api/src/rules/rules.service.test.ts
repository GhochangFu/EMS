import { describe, it } from "vitest";

import {
  duplicateAuditsThroughTheFunnelOnItsTransaction,
  previewWritesItsAuditRowThroughTheFunnelOnFleetDbWhenAssetless,
  runCompatiblePointWideningTests,
  runDuplicateRuleCopiesClearHoldTests,
  runRuleCodeUniquenessTests,
  runRuleSeverityRoundTripTests,
} from "./rules.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("rules.service", () => {
  it("stores the severity it was given, including none at all", async () => {
    await runRuleSeverityRoundTripTests();
  });

  // Hoisted out of the case above (it used to run nested inside it, so a
  // code-uniqueness failure reported under the severity test's name).
  it("scopes the code-uniqueness check to organizationId, and skips it when null", async () => {
    await runRuleCodeUniquenessTests();
  });

  it("accepts a point key the pinned template declares, and still refuses a half-built threshold draft (E2.4)", async () => {
    await runCompatiblePointWideningTests();
  });

  it("copies the clear hold onto a duplicated rule, null included (F3.10)", async () => {
    await runDuplicateRuleCopiesClearHoldTests();
  });

  it("audits a duplicate through MasterDataAuditService on its own transaction (F4.278)", async () => {
    await duplicateAuditsThroughTheFunnelOnItsTransaction();
  });

  it("audits an asset-less preview through MasterDataAuditService on fleetDb (F4.278)", async () => {
    await previewWritesItsAuditRowThroughTheFunnelOnFleetDbWhenAssetless();
  });
});
