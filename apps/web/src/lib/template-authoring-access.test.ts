import { describe, it } from "vitest";

import {
  runAuthoringRoleTests,
  runInstantiateRoleTests,
  runNoOrganizationScopeHelperTests,
  runViewRoleTests,
} from "./template-authoring-access.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template authoring access", () => {
  it("allows only admin and organization_admin to author", () => {
    runAuthoringRoleTests();
  });

  it("keeps instantiate open to a location admin", () => {
    runInstantiateRoleTests();
  });

  it("opens the page to whoever holds either capability", () => {
    runViewRoleTests();
  });

  it("exports no organization-scope helper, because the client cannot answer it", () => {
    runNoOrganizationScopeHelperTests();
  });
});
