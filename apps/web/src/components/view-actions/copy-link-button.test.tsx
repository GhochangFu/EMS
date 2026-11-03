// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aClickCopiesTheAddress,
  aRefusedWriteIsTheFixedSentence,
  noClipboardIsTheFixedSentence,
  restoreClipboard,
  theLabelReturnsAfterTwoSeconds,
} from "./copy-link-button.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.303 Copy link", () => {
  afterEach(() => {
    cleanup();
    restoreClipboard();
    vi.restoreAllMocks();
  });

  it("B1: copies window.location.href and reads Copied", async () => {
    await aClickCopiesTheAddress();
  });
  it("B2: shows the fixed sentence on a refused write and writes nothing to the console", async () => {
    await aRefusedWriteIsTheFixedSentence();
  });
  it("B3: shows the fixed sentence without a clipboard", async () => {
    await noClipboardIsTheFixedSentence();
  });
  it("reads Copy link again two seconds after a copy", async () => {
    await theLabelReturnsAfterTwoSeconds();
  });
});
