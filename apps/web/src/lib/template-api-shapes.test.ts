import { describe, it } from "vitest";

import {
  runTemplateContentRecordTests,
  runTemplateDetailRoundTripTests,
  runTemplateDraftDeletedTests,
  runTemplateListEnvelopeTests,
} from "./template-api-shapes.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("asset-template API shapes", () => {
  it("parses the list envelope and rejects a row that lost pointCount", () => {
    runTemplateListEnvelopeTests();
  });

  it("round-trips the five calc fields a draft PATCH would otherwise delete", () => {
    runTemplateDetailRoundTripTests();
  });

  it("accepts { deleted: true } only", () => {
    runTemplateDraftDeletedTests();
  });

  it("reads content as an open record, unknown keys included", () => {
    runTemplateContentRecordTests();
  });
});
