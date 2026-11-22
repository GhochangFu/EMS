// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  isDecorationOnly,
  joinsOnlyRealSites,
  keepsEverySiteOutOfTheClearZone,
  masksTheLinesWithTheClearZone,
  movesOnlyWhenMotionIsAllowed,
} from "./login-site-network.spec";

/**
 * `F4.398` (ADR 0142 Amendment 3) — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); the jsdom docblock is here because this is the file Vitest collects.
 */
afterEach(cleanup);

describe("F4.398 the login page's site network", () => {
  it("SN1 keeps every site out of the clear zone", () => {
    keepsEverySiteOutOfTheClearZone();
  });

  it("SN2 joins only real, different sites", () => {
    joinsOnlyRealSites();
  });

  it("SN3 is decoration only, drawn from lg up", () => {
    isDecorationOnly();
  });

  it("SN4 masks the lines with the clear zone's ellipse", () => {
    masksTheLinesWithTheClearZone();
  });

  it("SN5 moves only when motion is allowed", () => {
    movesOnlyWhenMotionIsAllowed();
  });
});
