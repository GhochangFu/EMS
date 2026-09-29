// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  drawsIonsiteBoldOnDark,
  drawsNexusInAccent,
  givesTheHeroTheSameNameAndText,
  namesTheHeaderWordmarkAsAnImage,
  readsIonsiteNexus,
  rendersNoImgElement,
} from "./wordmark.spec";

/**
 * `F3.33` U2 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
afterEach(cleanup);

describe("F3.33 the IONSiTE NEXUS text wordmark", () => {
  it("W1 names the header wordmark IONSiTE NEXUS as an image", () => {
    namesTheHeaderWordmarkAsAnImage();
  });

  it("W2 reads IONSiTE NEXUS", () => {
    readsIonsiteNexus();
  });

  it("W3 draws IONSiTE bold in on-dark", () => {
    drawsIonsiteBoldOnDark();
  });

  it("W4 draws NEXUS in accent", () => {
    drawsNexusInAccent();
  });

  it("W5 gives the hero the same name and text", () => {
    givesTheHeroTheSameNameAndText();
  });

  it("W6 renders no img element", () => {
    rendersNoImgElement();
  });
});
