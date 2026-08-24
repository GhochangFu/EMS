import { describe, it } from "vitest";

import {
  assertMigrationsDemandTheSuperuserUrl,
  assertMigrationsNeverFallBackToTheOwnerUrl,
} from "./migrate.spec";

describe("E7.1a / ADR 0045 — db:migrate runs on the provisioning connection", () => {
  it("resolves the migration connection from DATABASE_URL_SUPERUSER", () => {
    assertMigrationsDemandTheSuperuserUrl();
  });

  it("never falls back to DATABASE_URL, which now names the constrained owner", () => {
    assertMigrationsNeverFallBackToTheOwnerUrl();
  });
});
