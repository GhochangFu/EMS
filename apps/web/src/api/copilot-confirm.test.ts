import { afterEach, describe, it, vi } from "vitest";

import {
  anUploadIsSentAsFormData,
  anUploadSendsNoCardOnlyOrHashField,
  aBodylessChangeSendsBraces,
  aChangeWithNoCardOnlyKeySendsItsBodyWhole,
  aClientOnlyValueIsSentBesideTheStoredBody,
  aNonApiPathIsRefusedBeforeFetch,
  aRefusalIsAnApiError,
  aReplaceIsSentWithoutItsBaseline,
  itSendsTheStoredRequestWithTheHeader,
} from "./copilot-confirm.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: the project's `node` default.
 */
describe("F3.85 — the copilot Confirm executor (ADR 0099 decision 4.5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the stored method, path and body with the header", () => itSendsTheStoredRequestWithTheHeader());
  it("sends {} for a bodyless change", () => aBodylessChangeSendsBraces());
  it("refuses a non-API path before fetch", () => aNonApiPathIsRefusedBeforeFetch());
  it("turns a refusal into an ApiError", () => aRefusalIsAnApiError());
  it("sends a clientOnly value beside the stored body, and only there", () => aClientOnlyValueIsSentBesideTheStoredBody());
  it("F3.87 PR 5: sends a layout replace without its baseline", () => aReplaceIsSentWithoutItsBaseline());
  it("F3.87 PR 5: sends a body whole when its entry has no cardOnly key", () => aChangeWithNoCardOnlyKeySendsItsBodyWhole());
  it("F3.87 PR 6b: sends an upload as FormData with the file part and no explicit Content-Type", () => anUploadIsSentAsFormData());
  it("F3.87 PR 6b: sends no svgText, filename or hash field, and group only when stored", () => anUploadSendsNoCardOnlyOrHashField());
});
