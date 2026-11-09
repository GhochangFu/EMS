// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aCommittedSourcePostsItsId,
  aDraftSourceCopiesAndTheRowReadsSet,
  aRefusalIsShown,
  onlyAPlainMqttRtuGetsThePill,
  theDrawerSummaryDisclosesTlsOff,
} from "./draft-drawer.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.326 — the draft drawer discloses plain MQTT (ADR 0114 decision 6)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("D1 marks only a plain MQTT RTU with the Plain MQTT pill", onlyAPlainMqttRtuGetsThePill);
  it("D2 shows the TLS-off sentence in the summary", theDrawerSummaryDisclosesTlsOff);
  it("D3 copies from a draft RTU on the same broker; the row then reads Set (F4.339)", aDraftSourceCopiesAndTheRowReadsSet);
  it("D4 copies from a committed RTU by id (F4.339)", aCommittedSourcePostsItsId);
  it("D5 shows the server's refusal; the committed list is read only on open (F4.339)", aRefusalIsShown);
});
