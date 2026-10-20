// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aPlainRowHasNoExpandControl,
  aShortenedNowValueExpandsToItsOwnFullText,
  aShortenedRowExpandsToItsFullText,
  rowsOnOneFieldAreKeyedApart,
} from "./change-card.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.246 — a shortened card value expands to its full text (ADR 0099 §3, option C)", () => {
  afterEach(() => {
    cleanup();
  });

  it("expands a shortened value to its full text", () => aShortenedRowExpandsToItsFullText());
  it("expands a shortened Now value to its own full text", () => aShortenedNowValueExpandsToItsOwnFullText());
  it("renders a value shown whole as plain text, with no expand control", () => aPlainRowHasNoExpandControl());
  it("keys two rows on one field apart", () => rowsOnOneFieldAreKeyedApart());
});
