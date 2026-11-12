import { describe, it } from "vitest";

import {
  runMayShareBrokerTests,
  runReplaceBodySchemaTests,
  runReplaceNoBodyInAuditTests,
  runReplaceRefusalTests,
  runReplaceRoleTests,
  runReplaceSharedBrokerTests,
  runReplaceSiblingTests,
  runReplaceWriteTests,
} from "./rtus-credentials.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("PUT /admin/rtus/:id/credentials (F4.333, ADR 0129 decisions 2, 3 and 5)", () => {
  it("T3.1 the body is strict, bounded and a full replacement", () => {
    runReplaceBodySchemaTests();
  });

  it("T3.2 only admin and organization_admin may replace, within scope (Q4)", async () => {
    await runReplaceRoleTests();
  });

  it("T3.2 refuses in order, writing nothing (404, not MQTT, edge-served, control character, org drift, no key)", async () => {
    await runReplaceRefusalTests();
  });

  it("T3.2 writes the credential columns only, at the current key version, audited without values", async () => {
    await runReplaceWriteTests();
  });

  it("T3.2 gives siblings the same blob; one bad sibling refuses the whole request (Q3)", async () => {
    await runReplaceSiblingTests();
  });

  it("refuses an organization administrator on a broker another organization uses (PR 2 review L2)", async () => {
    await runReplaceSharedBrokerTests();
  });

  it("matches a broker fail-closed: a stored null host or port matches anything (review M1)", () => {
    runMayShareBrokerTests();
  });

  it("T3.5 no request body reaches an audit payload", () => {
    runReplaceNoBodyInAuditTests();
  });
});
