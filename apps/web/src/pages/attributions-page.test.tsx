// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aCreditRendersOneListItem,
  aNoticeIsTextNotMarkup,
  coreHasNoLinkAndNoNotice,
  fourEntriesRender,
  lucideShowsItsVersionAndLicence,
  lucideSourceLinkOpensSafely,
  mdiShowsItsNotice,
  theHeadingRenders,
} from "./attributions-page.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); jsdom opts in here (ADR 0042). */
describe("F3.32f the attributions page", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("T1 renders the Attributions heading", () => {
    theHeadingRenders();
  });
  it("T2 renders four entries", () => {
    fourEntriesRender();
  });
  it("T3 Lucide shows its version and licence", () => {
    lucideShowsItsVersionAndLicence();
  });
  it("T4 Lucide's Source link opens safely", () => {
    lucideSourceLinkOpensSafely();
  });
  it("T5 Core has no link and no notice", () => {
    coreHasNoLinkAndNoNotice();
  });
  it("T6 MDI shows its notice", () => {
    mdiShowsItsNotice();
  });
  it("T7 a notice is text, not markup", () => {
    aNoticeIsTextNotMarkup();
  });
  it("T8 a credit renders one list item", () => {
    aCreditRendersOneListItem();
  });
});
