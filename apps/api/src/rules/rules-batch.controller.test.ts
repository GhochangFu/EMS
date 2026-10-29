import { describe, it } from "vitest";

import {
  aMalformedBodyIsA400,
  aViewerIsRefusedBeforeTheBodyIsRead,
  theDtoAndTheReadableAssetsReachTheService,
} from "./rules-batch.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.289 — POST /rules/batch", () => {
  it("a viewer is refused before the body is read", () => aViewerIsRefusedBeforeTheBodyIsRead());
  it("a malformed body is a 400", () => aMalformedBodyIsA400());
  it("the dto and the readable assets reach the service", () => theDtoAndTheReadableAssetsReachTheService());
});
