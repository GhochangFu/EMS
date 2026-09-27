import { describe, it } from "vitest";

import {
  assertCallerWithoutTheGrantGetsA403,
  assertPathNeverOpensTheTenantTransaction,
  assertPathRefusesADriftedRtuWithA500,
} from "./rtus.service.tenant-agreement.spec";

/**
 * `F4.138` — Vitest entry point for the organization-agreement guard on the
 * three RTU write paths. Assertions live in the sibling `.spec` (ADR 0014,
 * AGENTS.md §4.6). One claim per `it`.
 */
describe.each(["update", "deactivate", "reactivate"] as const)(
  "F4.138 — RtusAdminService.%s on a drifted RTU",
  (path) => {
    it("refuses with the ruled 500", async () => {
      await assertPathRefusesADriftedRtuWithA500(path);
    });

    it("never opens the tenant transaction", async () => {
      await assertPathNeverOpensTheTenantTransaction(path);
    });

    it("answers a caller without the grant with a 403", async () => {
      await assertCallerWithoutTheGrantGetsA403(path);
    });
  },
);
