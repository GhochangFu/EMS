import { describe, it } from "vitest";

import {
  assertItRefusesAMultiConnectionPool,
  assertItRollsBackAndRethrowsOnFailure,
  assertTheTenantSettingIsScopedToTheTransaction,
  assertTheWorkRunsBetweenBeginAndCommit,
} from "./seed-tenant.spec";

describe("E7.1a / ADR 0045 — the seed's tenant context", () => {
  it("scopes app.current_organization to the transaction, never the session", async () => {
    await assertTheTenantSettingIsScopedToTheTransaction();
  });

  it("runs the work between BEGIN and COMMIT", async () => {
    await assertTheWorkRunsBetweenBeginAndCommit();
  });

  it("rolls back and rethrows rather than leaving half an organization", async () => {
    await assertItRollsBackAndRethrowsOnFailure();
  });

  it("refuses a pool that can hand out a second connection", async () => {
    await assertItRefusesAMultiConnectionPool();
  });
});
