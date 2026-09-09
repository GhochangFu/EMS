// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  saysNothingWhenThereIsNoError,
  saysSomethingWhenTheBodyIsNotAnEnvelope,
  showsTheServerSentenceAndNotItsEnvelope,
} from "./evaluate-refusal-notice.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest reads
 * it from the file it collects (ADR 0042 decision 2); `apps/web`'s project
 * defaults to `node`.
 */
describe("F3.47 evaluate refusal notice", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when the evaluate mutation has no error", () => {
    saysNothingWhenThereIsNoError();
  });

  it("shows the server's sentence and not its JSON envelope", () => {
    showsTheServerSentenceAndNotItsEnvelope();
  });

  it("falls back to the raw body when it is not a Nest envelope", () => {
    saysSomethingWhenTheBodyIsNotAnEnvelope();
  });
});
