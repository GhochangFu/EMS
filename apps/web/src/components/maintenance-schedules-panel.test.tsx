// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusedConvertShowsTheSentence,
  aRefusedCreateShowsTheSentence,
  aRefusedUpdateShowsTheSentence,
  highAndMediumPillsDiffer,
  highPillIsTheRuledStrongWarning,
  mediumPillIsTheRuledSoftWarning,
} from "./maintenance-schedules-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * jsdom docblock is here because Vitest reads it from the file it collects
 * (ADR 0042 decision 2).
 */
describe("F3.65b maintenance-schedule priority colours (owner ruling R-f)", () => {
  it("renders the high and medium priority pills differently", () => {
    highAndMediumPillsDiffer();
  });

  it("gives the high pill the solid warning line on the strong wash", () => {
    highPillIsTheRuledStrongWarning();
  });

  it("gives the medium pill the soft warning line on the plain wash", () => {
    mediumPillIsTheRuledSoftWarning();
  });
});

describe("F4.204 maintenance-schedule refusals read as a sentence, not the response body", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("MS1 a refused schedule create shows the server's sentence", async () => {
    await aRefusedCreateShowsTheSentence();
  });

  it("MS2 a refused convert to work order shows the server's sentence", async () => {
    await aRefusedConvertShowsTheSentence();
  });

  it("MS3 a refused schedule update shows the server's sentence", async () => {
    await aRefusedUpdateShowsTheSentence();
  });
});
