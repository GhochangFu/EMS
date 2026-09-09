import { afterEach, describe, it, vi } from "vitest";

import {
  aBlankTemplateRefusalKeepsTheStatusLine,
  aFourOhOneFromTheTemplateDownloadClearsTheSession,
  aFourOhOneFromTheUploadClearsTheSession,
  aFourOhThreeFromTheTemplateDownloadKeepsTheSession,
  aFourOhThreeFromTheUploadKeepsTheSession,
  anOversizeUploadNamesTheLimit,
  aRefusedTemplateDownloadRejectsWithTheSentence,
  aRefusedUploadRejectsWithTheSentenceAlone,
} from "./onboarding.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * No `@vitest-environment` docblock: this runs in the project default `node`,
 * because nothing here needs a DOM.
 */
describe("F4.106 onboarding api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the session when the upload is refused with a 401", async () => {
    await aFourOhOneFromTheUploadClearsTheSession();
  });

  it("keeps the session when the upload is refused with a 403", async () => {
    await aFourOhThreeFromTheUploadKeepsTheSession();
  });

  it("clears the session when the template download is refused with a 401", async () => {
    await aFourOhOneFromTheTemplateDownloadClearsTheSession();
  });

  it("keeps the session when the template download is refused with a 403", async () => {
    await aFourOhThreeFromTheTemplateDownloadKeepsTheSession();
  });

  it("names the 5 MB limit when the upload is too large", async () => {
    await anOversizeUploadNamesTheLimit();
  });

  it("rejects a refused upload with the server's sentence alone", async () => {
    await aRefusedUploadRejectsWithTheSentenceAlone();
  });

  it("rejects a refused template download with the server's sentence", async () => {
    await aRefusedTemplateDownloadRejectsWithTheSentence();
  });

  it("keeps the status line when a template refusal has no body", async () => {
    await aBlankTemplateRefusalKeepsTheStatusLine();
  });
});
