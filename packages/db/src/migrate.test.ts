import { describe, it } from "vitest";

import {
  assertABlockingStrayIsWarnedAboutAndNeverWritten,
  assertADifferingStampBecomesARestamp,
  assertADuplicateHashIsPlannedFromItsMaximumStamp,
  assertADuplicateHashPlansTheSameInEitherRowOrder,
  assertAFreshDatabaseIsLeftAlone,
  assertAJournalAheadOfTheClockIsRefusedBeforeAnyQuery,
  assertALoneNullStampIsRestamped,
  assertAMatchingDatabaseNeedsNoRestamp,
  assertANonIntegerJournalStampIsRefused,
  assertANullRowBesideACorrectDuplicateIsStillRestamped,
  assertANullStrayAlwaysBlocks,
  assertANullStrayIsWarnedAboutAsAChainReplay,
  assertAPartlyMigratedDatabaseReportsNothingUnreachable,
  assertAPlannedRestampThatWritesNothingIsReported,
  assertASecondRunRestampsNothing,
  assertAStrayAtAnUnappliedEntrysOwnStampNamesBothSides,
  assertAStrayShadowingAnUnappliedEntryBlocks,
  assertAStringCreatedAtIsComparedNumerically,
  assertAnUnappliedEntryBelowTheMaximumIsUnreachable,
  assertAnUnknownHashAheadOfTheJournalIsAStray,
  assertAnUnknownHashBehindTheJournalIsNotAStray,
  assertAnUnreachableEntryIsNamedInAWarning,
  assertEveryDifferingRowIsRestampedInJournalOrder,
  assertMigrationsDemandTheSuperuserUrl,
  assertMigrationsNeverFallBackToTheOwnerUrl,
  assertTheSummaryCountsRowsWrittenNotStatements,
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

  it("plans a duplicate hash from its maximum stamp, not the first row returned", () => {
    assertADuplicateHashIsPlannedFromItsMaximumStamp();
  });

  it("plans the same for a duplicate hash whichever order the rows come back in", () => {
    assertADuplicateHashPlansTheSameInEitherRowOrder();
  });

  it("does not report an unknown hash that sits behind the journal's last entry", () => {
    assertAnUnknownHashBehindTheJournalIsNotAStray();
  });

  it("reports an unknown hash that sits ahead of the journal's last entry", () => {
    assertAnUnknownHashAheadOfTheJournalIsAStray();
  });

  it("reports a stray that shadows a journal entry the database has not applied", () => {
    assertAStrayShadowingAnUnappliedEntryBlocks();
  });

  it("reports a journal entry with no applied row that sits below the table's maximum", () => {
    assertAnUnappliedEntryBelowTheMaximumIsUnreachable();
  });

  it("reports nothing unreachable on a database that is merely behind the journal", () => {
    assertAPartlyMigratedDatabaseReportsNothingUnreachable();
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

  it("names an unreachable journal entry and the maximum that shadows it", async () => {
    await assertAnUnreachableEntryIsNamedInAWarning();
  });

  it("refuses a journal stamped ahead of the wall clock before it reads or writes", async () => {
    await assertAJournalAheadOfTheClockIsRefusedBeforeAnyQuery();
  });

  it("refuses a journal stamp that is not a finite integer", async () => {
    await assertANonIntegerJournalStampIsRefused();
  });

  it("counts rows written, not statements issued, in the summary", async () => {
    await assertTheSummaryCountsRowsWrittenNotStatements();
  });

  it("says how many re-stamps were planned when fewer rows were written", async () => {
    await assertAPlannedRestampThatWritesNothingIsReported();
  });

  it("names both the unreachable entry and the stray when the stray sits at that entry's stamp", () => {
    assertAStrayAtAnUnappliedEntrysOwnStampNamesBothSides();
  });

  it("plans a re-stamp for a lone NULL created_at", () => {
    assertALoneNullStampIsRestamped();
  });

  it("plans a re-stamp for a NULL row even when a correct duplicate already matches the journal", () => {
    assertANullRowBesideACorrectDuplicateIsStillRestamped();
  });

  it("treats a stray with a NULL created_at as always blocking", () => {
    assertANullStrayAlwaysBlocks();
  });

  it("warns that a NULL stray makes drizzle replay the whole chain", async () => {
    await assertANullStrayIsWarnedAboutAsAChainReplay();
  });
});
