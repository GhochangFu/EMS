import { describe, it } from "vitest";

import {
  runForbiddenRequestCountTests,
  runRetryableRequestCountTests,
} from "./query-retry-requests.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("F4.63 — what a refusal costs in requests", () => {
  it("costs one request now, and four before", async () => {
    await runForbiddenRequestCountTests();
  });

  it("still spends the full budget on 429 and 5xx", async () => {
    await runRetryableRequestCountTests();
  });
});
