// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  detailsLoadFailureShowsTheThrownText,
  enrichmentSaveRefusalShowsTheServerSentence,
  keepsTheClassBlockDistinctFromTheInstanceEnrichment,
  offersNoControlThatCopiesTheClassTextIntoTheForm,
  omitsTheClassBlockEntirelyWhenThereIsNoProvenance,
  showsTheClassPhilosophyToAViewer,
  showsTheClassPhilosophyWithItsTemplateAndVersion,
} from "./alarm-details-panel.spec";

/**
 * `E2.2` (ADR 0059) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); the jsdom docblock is here because this is the file
 * Vitest collects (ADR 0042 decision 2).
 */
describe("E2.2 — the class philosophy on the Alarm Details panel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the class philosophy, naming the template version it came from", async () => {
    await showsTheClassPhilosophyWithItsTemplateAndVersion();
  });

  it("omits the block entirely when the rule carries no provenance", async () => {
    await omitsTheClassBlockEntirelyWhenThereIsNoProvenance();
  });

  it("keeps the class block distinct from the instance enrichment", async () => {
    await keepsTheClassBlockDistinctFromTheInstanceEnrichment();
  });

  it("shows the class philosophy to a viewer", async () => {
    await showsTheClassPhilosophyToAViewer();
  });

  it("offers no control that copies the class text into the enrichment form", async () => {
    await offersNoControlThatCopiesTheClassTextIntoTheForm();
  });

  it("F4.204 shows the server sentence, not the JSON envelope, when an enrichment save is refused", async () => {
    await enrichmentSaveRefusalShowsTheServerSentence();
  });

  it("F4.204 shows the thrown text unchanged when the details load fails", async () => {
    await detailsLoadFailureShowsTheThrownText();
  });
});
