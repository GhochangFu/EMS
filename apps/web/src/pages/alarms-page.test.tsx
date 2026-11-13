// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  ackRefusalShowsTheServerSentence,
  aDeviceAlarmCountsUnderIt,
  aDeviceAlarmHidesTheAssetOnlyActions,
  aDeviceAlarmIsAcknowledged,
  aDeviceAlarmNamesItsRtuOrTheIngestHost,
  aReasonThatTrimsShortStaysOnTheReasonStep,
  aNonSuppressedRowShowsNoBadge,
  aReturnedRowShowsNoBadge,
  aSuppressedRowShowsTheBadge,
  searchingMaintenanceFindsTheSuppressedRow,
  theSuppressedControlSendsStateSuppressed,
  countsActiveAsUnclearedAndAcknowledgedAsStamped,
  offersAckOnExactlyTheUnacknowledgedRows,
  rendersAllFourLifecycleStates,
  searchingClearedKeepsBothClearedRows,
  theAckSendsTheTrimmedReason,
  theAssetCellFallsBackToTheLocation,
  theAssetCellNamesTheRtu,
  theAssetCellsWherePartWraps,
} from "./alarms-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.10 alarm lifecycle on the alarms page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders all four lifecycle states", async () => {
    await rendersAllFourLifecycleStates();
  });

  it("counts Active as uncleared, not as unacknowledged", async () => {
    await countsActiveAsUnclearedAndAcknowledgedAsStamped();
  });

  it("offers Ack on the active and the cleared-unacknowledged rows only", async () => {
    await offersAckOnExactlyTheUnacknowledgedRows();
  });

  it("finds both cleared alarms when searching for cleared", async () => {
    await searchingClearedKeepsBothClearedRows();
  });

  it("F4.204 shows the server sentence, not the JSON envelope, when an ack is refused", async () => {
    await ackRefusalShowsTheServerSentence();
  });

  it("F4.284 keeps a reason that trims below 3 characters on the Reason step", async () => {
    await aReasonThatTrimsShortStaysOnTheReasonStep();
  });

  it("F4.284 sends the trimmed reason the Review card shows", async () => {
    await theAckSendsTheTrimmedReason();
  });

  it("F4.316 the Asset cell reads code · RTU", async () => {
    await theAssetCellNamesTheRtu();
  });

  it("F4.316 the Asset cell falls back to the location with no RTU", async () => {
    await theAssetCellFallsBackToTheLocation();
  });

  it("F4.316 the Asset cell's where part wraps, never truncates", async () => {
    await theAssetCellsWherePartWraps();
  });

  it("F3.16 a device alarm names its RTU or the ingest host; a rule alarm renders as before", async () => {
    await aDeviceAlarmNamesItsRtuOrTheIngestHost();
  });

  it("F3.16 a device alarm hides the work order and keeps Details and Ack", async () => {
    await aDeviceAlarmHidesTheAssetOnlyActions();
  });

  it("F3.16 a device alarm counts under IT by its source, not its message", async () => {
    await aDeviceAlarmCountsUnderIt();
  });

  it("F3.16 a device alarm is acknowledged, the Review card naming the device", async () => {
    await aDeviceAlarmIsAcknowledged();
  });

  it("F4.359 a suppressed row shows the Maintenance badge", async () => {
    await aSuppressedRowShowsTheBadge();
  });

  it("F4.359 a non-suppressed row shows no badge", async () => {
    await aNonSuppressedRowShowsNoBadge();
  });

  it("F4.359 a returned row (window id kept, suppressed false) shows no badge", async () => {
    await aReturnedRowShowsNoBadge();
  });

  it("F4.359 the Suppressed only control reads state=suppressed", async () => {
    await theSuppressedControlSendsStateSuppressed();
  });

  it("F4.359 searching maintenance finds the suppressed row", async () => {
    await searchingMaintenanceFindsTheSuppressedRow();
  });
});
