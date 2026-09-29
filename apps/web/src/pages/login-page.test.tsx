// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  accentsTheDescriptorCore,
  drawsNoImgElement,
  readsNoTrinetra,
  readsTheCardHeading,
  readsTheCardSentence,
  readsTheFooterVersion,
  readsTheHeroHeadline,
  readsTheRolePills,
  showsTheWordmark,
} from "./login-page.spec";

/**
 * `F3.33` U4 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("F3.33 the login page reads IONSiTE NEXUS", () => {
  it("L1 shows the wordmark as a named image", () => {
    showsTheWordmark();
  });

  it("L2 reads the hero headline", () => {
    readsTheHeroHeadline();
  });

  it("L2b accents Building, Energy, Water & Utility in the headline", () => {
    accentsTheDescriptorCore();
  });

  it("L3 reads the card heading", () => {
    readsTheCardHeading();
  });

  it("L4 reads the card sentence", () => {
    readsTheCardSentence();
  });

  it("L5 reads the three role pills in order", () => {
    readsTheRolePills();
  });

  it("L6 reads the footer version line", () => {
    readsTheFooterVersion();
  });

  it("L7 draws no img element", () => {
    drawsNoImgElement();
  });

  it("L8 reads no TRINETRA", () => {
    readsNoTrinetra();
  });
});
