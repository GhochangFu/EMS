// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  ackRefusalShowsTheServerSentence,
  aReasonThatTrimsShortStaysOnTheReasonStep,
  countsActiveAsUnclearedAndAcknowledgedAsStamped,
  offersAckOnExactlyTheUnacknowledgedRows,
  rendersAllFourLifecycleStates,
  searchingClearedKeepsBothClearedRows,
  theAckSendsTheTrimmedReason,
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
});
