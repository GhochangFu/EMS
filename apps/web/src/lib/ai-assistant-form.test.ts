import { describe, it } from "vitest";

import {
  choiceControlsAndLabels,
  defaultModelPlaceholderPerProvider,
  keySetLineShowsLast4AndDate,
  platformChoiceSavesAsDelete,
  platformSummaryNamesTheVisionModel,
  putBodyCarriesTheVisionModel,
  putBodyRules,
  testBodyCarriesTheVisionModel,
  testBodyRules,
  testResultLinesOneOrTwo,
  testStatusSentences,
  visionModelHelpText,
} from "./ai-assistant-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("ai-assistant-form (F3.21)", () => {
  it("uses each provider's default model as the placeholder, and OpenRouter has none", () => {
    defaultModelPlaceholderPerProvider();
  });

  it("shows the key's last four characters and the date, or No key set", () => {
    keySetLineShowsLast4AndDate();
  });

  it("saves Platform default as a DELETE and every other choice as a PUT", () => {
    platformChoiceSavesAsDelete();
  });

  it("has one plain sentence for each of the eight test statuses", () => {
    testStatusSentences();
  });

  it("builds the PUT body: Off alone, a blank key omitted, OpenRouter needs a model", () => {
    putBodyRules();
  });

  it("builds the Test body: the platform default as configured, or the chosen provider", () => {
    testBodyRules();
  });

  it("enables the key field and Test per choice, and words the platform default", () => {
    choiceControlsAndLabels();
  });

  it("F4.267 sends a typed vision model in the PUT body, omits an empty one, never with Off", () => {
    putBodyCarriesTheVisionModel();
  });

  it("F4.267 tests the typed vision model, or the platform default's own", () => {
    testBodyCarriesTheVisionModel();
  });

  it("F4.267 names the platform's model for images in the summary", () => {
    platformSummaryNamesTheVisionModel();
  });

  it("F4.267 shows one Test line, or two when the vision model was checked", () => {
    testResultLinesOneOrTwo();
  });

  it("F4.267 words the help line under Model for images", () => {
    visionModelHelpText();
  });
});
