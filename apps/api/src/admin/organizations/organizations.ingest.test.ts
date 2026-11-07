import { describe, it } from "vitest";

import {
  aChangeWritesOnePlatformAuditRow,
  anUnknownIdIs404,
  everyoneButTheGlobalAdminIsRefusedBeforeARead,
  theStoredValueWritesNothing,
} from "./organizations.ingest.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.330 OrganizationsAdminService.setIngestEnabled — control flow (ADR 0115)", () => {
  it("U1 every role but admin is a 403 before any read", async () => {
    await everyoneButTheGlobalAdminIsRefusedBeforeARead();
  });

  it("U2 an unknown id is a 404 and writes nothing", async () => {
    await anUnknownIdIs404();
  });

  it("U3 the stored value returns the row with no update and no audit row", async () => {
    await theStoredValueWritesNothing();
  });

  it("U4 a change writes one platform audit row on fleetDb", async () => {
    await aChangeWritesOnePlatformAuditRow();
  });
});
