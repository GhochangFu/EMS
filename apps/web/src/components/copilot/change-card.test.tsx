// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aDeactivateCardDoesNotSayItCannotBeUndone,
  aDeactivateCardIsRed,
  anOperationalCardIsRed,
  anOperationalCardSaysItCannotBeUndone,
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

describe("F4.284 — the operational risk class is red and cannot be undone (ADR 0106 decision 4)", () => {
  afterEach(() => {
    cleanup();
  });

  it("styles an operational card red", () => anOperationalCardIsRed());
  it("says an operational card cannot be undone", () => anOperationalCardSaysItCannotBeUndone());
  it("styles a deactivate card red", () => aDeactivateCardIsRed());
  it("does not say a deactivate card cannot be undone", () => aDeactivateCardDoesNotSayItCannotBeUndone());
});
