import { describe, it } from "vitest";

import {
  aPayloadWithoutOrganizationIsRefused,
  aValidPayloadParses,
  allQueuesListsTheDeclaration,
  anExtraKeyIsRefused,
  theJobIdMatchesTheGrammar,
  theQueueIsTenant,
} from "./calc-backfill.spec";

/** `F4.311` PR 5a — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.311 — the calc-backfill queue declaration", () => {
  it("parses a valid payload", aValidPayloadParses);
  it("refuses a payload without organizationId", aPayloadWithoutOrganizationIsRefused);
  it("refuses an extra key (the schema is strict)", anExtraKeyIsRefused);
  it("is a tenant queue", theQueueIsTenant);
  it("builds a job id inside JOB_ID_PATTERN", theJobIdMatchesTheGrammar);
  it("is listed in ALL_QUEUES", allQueuesListsTheDeclaration);
});
