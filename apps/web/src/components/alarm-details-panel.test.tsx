// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aDeviceAlarmHidesTheAssetSections,
  aDeviceAlarmsHeaderNamesItsRtuOrTheIngestHost,
  aRuleAlarmKeepsTheAssetSections,
  detailsLoadFailureReadsTheEnvelopeSentence,
  enrichmentSaveRefusalShowsTheServerSentence,
  keepsTheClassBlockDistinctFromTheInstanceEnrichment,
  linksTheAssetToItsHistory,
  offersNoControlThatCopiesTheClassTextIntoTheForm,
  omitsTheClassBlockEntirelyWhenThereIsNoProvenance,
  showsTheClassPhilosophyToAViewer,
  showsTheClassPhilosophyWithItsTemplateAndVersion,
  theAffectedAssetsListTheirLabels,
  theHeaderFallsBackToTheLocation,
  theHeaderNamesTheRtu,
  theHeadersWherePartWraps,
  theHistoryLinkKeepsTheCode,
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

  it("F4.204 reads the envelope sentence when the details load fails", async () => {
    await detailsLoadFailureReadsTheEnvelopeSentence();
  });

  it("F4.297 links the asset to its history page", async () => {
    await linksTheAssetToItsHistory();
  });

  it("F4.316 the header names the asset as code · RTU", async () => {
    await theHeaderNamesTheRtu();
  });

  it("F4.316 the header falls back to the location with no RTU", async () => {
    await theHeaderFallsBackToTheLocation();
  });

  it("F4.316 the header's where part wraps, never truncates", async () => {
    await theHeadersWherePartWraps();
  });

  it("F4.316 the history link keeps the bare asset code", async () => {
    await theHistoryLinkKeepsTheCode();
  });

  it("F4.316 the affected assets list their labels", async () => {
    await theAffectedAssetsListTheirLabels();
  });

  it("F3.16 a device alarm's header names its RTU or the ingest host", async () => {
    await aDeviceAlarmsHeaderNamesItsRtuOrTheIngestHost();
  });

  it("F3.16 a device alarm hides the asset link, the asset rows and the enrichment", async () => {
    await aDeviceAlarmHidesTheAssetSections();
  });

  it("F3.16 a rule alarm keeps the asset link, the asset rows and the enrichment form", async () => {
    await aRuleAlarmKeepsTheAssetSections();
  });
});
