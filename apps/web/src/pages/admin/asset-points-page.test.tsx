// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusedCreateShowsTheSentence,
  aStoredRtuOutsideTheListKeepsItsOption,
  addPicksAnRtuOfTheAssetsLocation,
  addWithNoLocationDisablesTheRtuSelect,
  anEditSendsOnlyTheChangedField,
  anUntouchedEditSendsNothing,
  choosingUnwiredSendsNull,
  theEditRtuSelectShowsTheStoredRtu,
  theListShowsTheInheritedEffectiveRange,
  theListShowsTheInheritedEffectiveScaleAndQuality,
} from "./asset-points-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2).
 */
/**
 * Per-case timeout, as `escalation-profiles-page.test.tsx` sets it. Measured
 * at 2–3 s alone on a dev machine; the margin is for a loaded parallel run,
 * where a `userEvent` walk through the page can pass Vitest's 5 s default.
 */
const CASE_TIMEOUT_MS = 15_000;

describe("asset points page — refusals, effective metadata, the Add/Edit dialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("F4.204 a refused add-mapping save shows the sentence, not the envelope", async () => {
    await aRefusedCreateShowsTheSentence();
  }, CASE_TIMEOUT_MS);

  it("F2.25 the Range cell shows the template's bound, marked inherited; an own bound is not", async () => {
    await theListShowsTheInheritedEffectiveRange();
  }, CASE_TIMEOUT_MS);

  it("F2.25 the Scale and Quality cells show the template's values, marked inherited; own values win", async () => {
    await theListShowsTheInheritedEffectiveScaleAndQuality();
  }, CASE_TIMEOUT_MS);

  it("F2.31 an edit sends only the field that changed", async () => {
    await anEditSendsOnlyTheChangedField();
  }, CASE_TIMEOUT_MS);

  it("F2.31 an untouched edit closes the dialog without a request", async () => {
    await anUntouchedEditSendsNothing();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (1) Edit lists the location's RTUs, shows the stored one, and sends no untouched rtuId", async () => {
    await theEditRtuSelectShowsTheStoredRtu();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (2) choosing Unwired on Edit sends rtuId: null", async () => {
    await choosingUnwiredSendsNull();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (3) a stored RTU outside the location list keeps its option and its value", async () => {
    await aStoredRtuOutsideTheListKeepsItsOption();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (4) Add omits a blank RTU and sends a chosen one of the asset's location", async () => {
    await addPicksAnRtuOfTheAssetsLocation();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (5) Add with no location known disables the RTU select and says why", async () => {
    await addWithNoLocationDisablesTheRtuSelect();
  }, CASE_TIMEOUT_MS);
});
