import { describe, it } from "vitest";

import {
  assertABlockingStrayIsWarnedAboutAndNeverWritten,
  assertADifferingStampBecomesARestamp,
  assertAFreshDatabaseIsLeftAlone,
  assertAMatchingDatabaseNeedsNoRestamp,
  assertASecondRunRestampsNothing,
  assertAStringCreatedAtIsComparedNumerically,
  assertAnUnknownHashAheadOfTheJournalIsAStray,
  assertAnUnknownHashBehindTheJournalIsNotAStray,
  assertEveryDifferingRowIsRestampedInJournalOrder,
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

describe("F4.94 — db:migrate re-syncs drizzle's stamps to the journal before migrating", () => {
  it("plans no re-stamp when every applied row already matches the journal", () => {
    assertAMatchingDatabaseNeedsNoRestamp();
  });

  it("plans a re-stamp for a row whose stamp differs from the journal", () => {
    assertADifferingStampBecomesARestamp();
  });

  it("does not report an unknown hash that sits behind the journal's last entry", () => {
    assertAnUnknownHashBehindTheJournalIsNotAStray();
  });

  it("reports an unknown hash that sits ahead of the journal's last entry", () => {
    assertAnUnknownHashAheadOfTheJournalIsAStray();
  });

  it("compares a string created_at numerically, as drizzle does", () => {
    assertAStringCreatedAtIsComparedNumerically();
  });

  it("reads and writes nothing on a database that has no drizzle table yet", async () => {
    await assertAFreshDatabaseIsLeftAlone();
  });

  it("issues one guarded UPDATE per differing row, in journal order", async () => {
    await assertEveryDifferingRowIsRestampedInJournalOrder();
  });

  it("writes nothing on a second run and still reports the summary", async () => {
    await assertASecondRunRestampsNothing();
  });

  it("warns about a stray row ahead of the journal and never writes it", async () => {
    await assertABlockingStrayIsWarnedAboutAndNeverWritten();
  });
});
