// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aDropOnReviewOpensTheWizardAndCallsNoReorder,
  aFailedListReadSettles,
  anAlarmTicketCannotLeaveTheStepWithoutItsFindings,
  aPlannedTicketResolvesWithoutFindings,
  choosingResolvedShowsTheRootCauseSection,
  findingsAlreadySavedAreNotAskedForAgain,
  findingsAreNotSentWithAnotherStatus,
  theFindingsAreSentWithTheResolve,
  aRefusedCloseShowsTheSentence,
  aRefusedCreateShowsTheSentence,
  aRefusedReorderShowsTheSentence,
  aRefusedStatusChangeShowsTheSentence,
  highAndMediumPillsDiffer,
  highAndMediumRailsDiffer,
  highPillIsTheRuledStrongWarning,
  mediumPillIsTheRuledSoftWarning,
  mediumRailIsTheHalfOpacityWarning,
  aCloseReasonThatTrimsShortStaysOnTheReasonStep,
  theCardFallsBackToTheLocation,
  theCardNamesTheRtu,
  theCardsWherePartWraps,
  theCloseReviewSaysItCannotBeUndone,
  theStatusWizardOffersNoClosed,
} from "./work-orders-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * jsdom docblock is here because Vitest reads it from the file it collects
 * (ADR 0042 decision 2); importing the page module loads browser-only stores.
 */
describe("F3.65b work-order priority colours (owner ruling R-f)", () => {
  it("renders the high and medium priority pills differently", () => {
    highAndMediumPillsDiffer();
  });

  it("gives the high pill the solid warning line on the strong wash", () => {
    highPillIsTheRuledStrongWarning();
  });

  it("gives the medium pill the soft warning line on the plain wash", () => {
    mediumPillIsTheRuledSoftWarning();
  });

  it("renders the high and medium card rails differently", () => {
    highAndMediumRailsDiffer();
  });

  it("gives the medium rail the half-opacity warning border", () => {
    mediumRailIsTheHalfOpacityWarning();
  });
});

describe("F4.204 work-order refusals read as a sentence, not the response body", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("WO1 a refused create shows the server's sentence", async () => {
    await aRefusedCreateShowsTheSentence();
  });

  it("WO2 a refused status change shows the server's sentence", async () => {
    await aRefusedStatusChangeShowsTheSentence();
  });

  it("WO3 a refused close shows the server's sentence", async () => {
    await aRefusedCloseShowsTheSentence();
  });

  it("WO4 a refused kanban reorder shows the server's sentence", async () => {
    await aRefusedReorderShowsTheSentence();
  });
});

describe("F4.209 the work-orders page settles while its list has no data", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // The commit bound is the fail-fast gate; the per-test timeout is the backstop.
  it("WO5 a failed list read settles without a render loop", async () => {
    await aFailedListReadSettles();
  }, 10_000);
});

describe("F4.284 the work-order wizards (ADR 0106 decisions 2, 4)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("WO6 the status wizard offers no closed", async () => {
    await theStatusWizardOffersNoClosed();
  });

  it("WO7 the close's Review card says it cannot be undone", async () => {
    await theCloseReviewSaysItCannotBeUndone();
  });

  it("WO8 a closure reason that trims below 3 characters stays on the Reason step", async () => {
    await aCloseReasonThatTrimsShortStaysOnTheReasonStep();
  });

  it("WO9 the card's asset line names the RTU", async () => {
    await theCardNamesTheRtu();
  });

  it("WO10 an asset without an RTU is named by its location", async () => {
    await theCardFallsBackToTheLocation();
  });

  it("WO11 the card's where part wraps instead of truncating", async () => {
    await theCardsWherePartWraps();
  });
});

describe("E3.1 the status wizard's Root cause section and the drop on Review (ADR 0122 decision 5, ruling P1)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the Root cause section when resolved is chosen, and not for another status", async () => {
    await choosingResolvedShowsTheRootCauseSection();
  });

  it("keeps an alarm ticket on the Status step until it has its three findings", async () => {
    await anAlarmTicketCannotLeaveTheStepWithoutItsFindings();
  });

  it("sends the findings with the resolve", async () => {
    await theFindingsAreSentWithTheResolve();
  });

  it("does not ask again for findings the ticket already holds", async () => {
    await findingsAlreadySavedAreNotAskedForAgain();
  });

  it("drops the typed findings when the status moves off resolved", async () => {
    await findingsAreNotSentWithAnotherStatus();
  });

  it("lets a planned ticket resolve with no findings", async () => {
    await aPlannedTicketResolvesWithoutFindings();
  });

  it("opens the status wizard on a drop on Review and calls no reorder", async () => {
    await aDropOnReviewOpensTheWizardAndCallsNoReorder();
  });
});
