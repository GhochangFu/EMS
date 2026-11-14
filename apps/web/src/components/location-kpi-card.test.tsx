// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aLiveCardShowsTheLiveBadgeAndTheGreenEdge,
  aNotLiveCardMutesEveryFirstFigure,
  aNotLiveCardShowsTheNotLiveBadgeAndTheAmberEdge,
  anUnscoredHealthCardReadsADash,
  cleanupCard,
  noneShowsTwoFigures,
  theFirstFigureFollowsPrimaryMetric,
  fallsBackToTheTypeLabelNotTheRawCode,
  theDefaultLinksToTheControlRoomSite,
  toReplacesTheLinkTarget,
} from "./location-kpi-card.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.66 U3 LocationKpiCard link target (D4)", () => {
  afterEach(() => {
    cleanupCard();
  });

  it("K1 links to the Control Room site view by default (F3.72 OQ7)", () => {
    theDefaultLinksToTheControlRoomSite();
  });

  it("K2 links to `to` when it is given", () => {
    toReplacesTheLinkTarget();
  });

  it("K4 falls back to typeLabel, not the raw type code, when province is null", () => {
    fallsBackToTheTypeLabelNotTheRawCode();
  });

  it("K5 a live site shows the Live badge and the green left edge (F4.259)", () => {
    aLiveCardShowsTheLiveBadgeAndTheGreenEdge();
  });

  it("K6 a site that is not live shows the Not live badge and the amber left edge (F4.259)", () => {
    aNotLiveCardShowsTheNotLiveBadgeAndTheAmberEdge();
  });

  it("K7 the first figure follows primaryMetric and names it in data-metric (F4.364)", () => {
    theFirstFigureFollowsPrimaryMetric();
  });

  it("K8 an unscored health card reads a dash, never 0 (F4.364)", () => {
    anUnscoredHealthCardReadsADash();
  });

  it("K9 none shows two figures in two columns (F4.364)", () => {
    noneShowsTwoFigures();
  });

  it("K10 a card that is not live mutes every first figure (F4.364)", () => {
    aNotLiveCardMutesEveryFirstFigure();
  });
});
