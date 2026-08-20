import { describe, it } from "vitest";

import {
  runBuildManualReadingRowTests,
  runDefaultLocalDateTimeTests,
  runDescribeWriteOutcomeTests,
  runLocalDateTimeToIsoTests,
  runValidateManualReadingFormTests,
} from "./manual-reading-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("manual-reading-form", () => {
  it("converts a datetime-local value to an absolute UTC instant given an explicit offset", () => {
    runLocalDateTimeToIsoTests();
  });

  it("formats an injected Date as a datetime-local control value", () => {
    runDefaultLocalDateTimeTests();
  });

  it("builds a TelemetryEntryRow, omitting unit unless it was edited from the catalog default", () => {
    runBuildManualReadingRowTests();
  });

  it("describes a write outcome without ever claiming success on written: 0", () => {
    runDescribeWriteOutcomeTests();
  });

  it("validates client-side format only, leaving semantic rules to the server", () => {
    runValidateManualReadingFormTests();
  });
});
