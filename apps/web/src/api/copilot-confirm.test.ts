import { afterEach, describe, it, vi } from "vitest";

import {
  aBodylessChangeSendsBraces,
  aRefusalIsAnApiError,
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
  it("turns a refusal into an ApiError", () => aRefusalIsAnApiError());
});
