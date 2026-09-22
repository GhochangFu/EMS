import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationDb } from "../testing/integration-db-gate";
import { requireIntegrationStorage } from "../testing/integration-storage-gate";
import {
  adminCreatesForEskomAndTheRowIsForced,
  theInsertStampedWithAForeignOrganizationIs42501,
  wcAdminCreatesOnlyWithItsOwnLocation,
  assetGroupAdminIsRefusedOnEveryRoute,
  pheAdminListsOnlyPhewb,
  wcAdminSeesItsOwnAndNotTheAdminsEmptyScopeRow,
  wcAdminCannotReadTheWholeOrganizationSchedule,
  aScheduledFileDoesNotCountTowardTheOnDemandCap,
  removeTakesTheFilesWithIt,
  channelOfThisOrganizationIsAccepted,
  wcAdminCannotAttachAChannel,
  auditRowsCarryIdsOnly,
  runAtLocalRoundTripsAsHHMM,
  reenableMovesNextRunAtOnARealRow,
  openScheduleFixtures,
  type OpenScheduleFixtures,
  type ScheduleIntegrationFixtures,
} from "./report-schedules.integration.spec";

/**
 * `F3.5b` U11 — Vitest entry point for the schedule-route integration suite.
 * Assertions live in the sibling `.spec` (§4.6 / ADR 0014); the lifecycle —
 * pools, seeded ids by code, the storage client and the id-bounded sweep
 * with its count assertions — is `report-schedules.integration.spec.ts`.
 *
 * **Two gates, and they are not interchangeable.** `requireIntegrationDb`
 * decides on `DATABASE_URL`, `requireIntegrationStorage` on
 * `OBJECT_STORAGE_ENDPOINT`; either unset skips locally and refuses in CI.
 */
const connectionString = requireIntegrationDb({
  item: "F3.5b",
  label: "report schedule integration tests",
  because:
    "these are the only tests that prove 0078 refuses a schedule stamped with another organization, " +
    "that the tenant policy hides a schedule under the other organization's GUC, that a location " +
    "admin's real grants admit exactly its own location, that a scheduled file is spared from the " +
    "on-demand cap, that a removed schedule takes its file rows and objects with it, and what pg " +
    "returns for time(0). Every other schedule test runs over fakes and passes with all of those broken.",
});

const storageConfig = requireIntegrationStorage({
  item: "F3.5b",
  label: "report schedule integration tests",
  because:
    "an in-memory S3Ops cannot tell you whether the objects of a removed schedule are really gone " +
    "from the bucket (ADR 0071 decision 11; Q-2).",
});

describe.skipIf(!connectionString || !storageConfig)("F3.5b — the schedule routes against Postgres and MinIO", () => {
  let opened: OpenScheduleFixtures | undefined;
  let fx: ScheduleIntegrationFixtures;

  beforeAll(async () => {
    opened = await openScheduleFixtures(connectionString as string, storageConfig!, "F3.5b schedules");
    fx = opened.fx;
  });

  afterAll(async () => {
    await opened?.close();
  });

  it("adminCreatesForEskomAndTheRowIsForced", async () => {
    await adminCreatesForEskomAndTheRowIsForced(fx);
  });

  it("theInsertStampedWithAForeignOrganizationIs42501", async () => {
    await theInsertStampedWithAForeignOrganizationIs42501(fx);
  });

  it("wcAdminCreatesOnlyWithItsOwnLocation — [WC] is admitted", async () => {
    await wcAdminCreatesOnlyWithItsOwnLocation(fx, "WC");
  });

  it("wcAdminCreatesOnlyWithItsOwnLocation — [OTHER] is 403", async () => {
    await wcAdminCreatesOnlyWithItsOwnLocation(fx, "OTHER");
  });

  it("wcAdminCreatesOnlyWithItsOwnLocation — [] is 403", async () => {
    await wcAdminCreatesOnlyWithItsOwnLocation(fx, "EMPTY");
  });

  it("assetGroupAdminIsRefusedOnEveryRoute", async () => {
    await assetGroupAdminIsRefusedOnEveryRoute(fx);
  });

  it("pheAdminListsOnlyPhewb", async () => {
    await pheAdminListsOnlyPhewb(fx);
  });

  it("wcAdminSeesItsOwnAndNotTheAdminsEmptyScopeRow", async () => {
    await wcAdminSeesItsOwnAndNotTheAdminsEmptyScopeRow(fx);
  });

  it("wcAdminCannotReadTheWholeOrganizationSchedule", async () => {
    await wcAdminCannotReadTheWholeOrganizationSchedule(fx);
  });

  it("aScheduledFileDoesNotCountTowardTheOnDemandCap", async () => {
    await aScheduledFileDoesNotCountTowardTheOnDemandCap(fx);
  });

  it("removeTakesTheFilesWithIt", async () => {
    await removeTakesTheFilesWithIt(fx);
  });

  it("channelOfThisOrganizationIsAccepted", async () => {
    await channelOfThisOrganizationIsAccepted(fx);
  });

  it("wcAdminCannotAttachAChannel", async () => {
    await wcAdminCannotAttachAChannel(fx);
  });

  it("auditRowsCarryIdsOnly", async () => {
    await auditRowsCarryIdsOnly(fx);
  });

  it("runAtLocalRoundTripsAsHHMM", async () => {
    await runAtLocalRoundTripsAsHHMM(fx);
  });

  it("reenableMovesNextRunAtOnARealRow", async () => {
    await reenableMovesNextRunAtOnARealRow(fx);
  });
});
