// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { aReadOnlyRenderCannotSubmitEvenWhenTheFormIsDirty } from "./details-tab.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.15 details tab — the submit handler is gated on editable", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("refuses to submit a read-only render even when the form is dirty", async () => {
    await aReadOnlyRenderCannotSubmitEvenWhenTheFormIsDirty();
  });
});
