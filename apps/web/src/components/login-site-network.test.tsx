// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  isDecorationOnly,
  joinsOnlyRealSites,
  keepsEveryLineClearOfText,
  keepsEverySiteClearOfText,
  movesOnlyWhenMotionIsAllowed,
  spreadsTheSitesEvenly,
} from "./login-site-network.spec";

/**
 * `F4.398` (ADR 0142 Amendments 3 and 4) — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); the jsdom docblock is here because this is the file Vitest collects.
 */
afterEach(cleanup);

describe("F4.398 the login page's site network", () => {
  it("SN1 draws no site near a text block", () => {
    keepsEverySiteClearOfText();
  });

  it("SN2 joins only real, different sites", () => {
    joinsOnlyRealSites();
  });

  it("SN3 is decoration only, drawn from lg up", () => {
    isDecorationOnly();
  });

  it("SN4 draws no line near a text block", () => {
    keepsEveryLineClearOfText();
  });

  it("SN5 moves only when motion is allowed", () => {
    movesOnlyWhenMotionIsAllowed();
  });

  it("SN6 spreads the sites evenly over the panel", () => {
    spreadsTheSitesEvenly();
  });
});
