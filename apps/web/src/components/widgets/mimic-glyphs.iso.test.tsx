// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aCoreTankKeepsTheCoreLevel,
  aKindWithoutATwinIsUnchangedUnderIso,
  anIsoTankDrawsItsTwinFilled,
  anIsoTankKeepsItsLiveLevel,
  theIsoLevelPathIsExact,
} from "./mimic-glyphs.iso.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); jsdom opts in here (ADR 0042). */
describe("F4.345 — MimicGlyph under the iso glyph set (ADR 0121 decisions 5 and 6)", () => {
  afterEach(() => {
    cleanup();
  });

  it("GI1 an iso tank draws its isometric twin in the fill style", async () => {
    await anIsoTankDrawsItsTwinFilled();
  });
  it("GI2 an iso tank keeps its live level inside the generated level box", async () => {
    await anIsoTankKeepsItsLiveLevel();
  });
  it("GI3 a core tank keeps the core level path", () => {
    aCoreTankKeepsTheCoreLevel();
  });
  it("GI4 a library key and alert are unchanged under iso", async () => {
    await aKindWithoutATwinIsUnchangedUnderIso();
  });
  it("GI5 the iso level path is exact", () => {
    theIsoLevelPathIsExact();
  });
});
