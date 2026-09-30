import { describe, it } from "vitest";

import {
  noModuleStaticallyImportsALazyModule,
  theScanRecognisesEveryForm,
  theStoreImportsEachLazyModuleDynamically,
} from "./chunk-split.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32h the lazy mimic libraries stay out of the main chunk", () => {
  it("C1 the scan recognises every form", () => {
    theScanRecognisesEveryForm();
  });
  it("C2 no module statically imports a lazy module", () => {
    noModuleStaticallyImportsALazyModule();
  });
  it("C3 the store imports each lazy module dynamically", () => {
    theStoreImportsEachLazyModuleDynamically();
  });
});
