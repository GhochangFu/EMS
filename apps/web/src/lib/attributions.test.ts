import { describe, it } from "vitest";

import {
  coreHasNoSourceNoticeOrCredits,
  listsTheFourLibrariesInOrder,
  lucideCarriesItsLicenceVersionAndSource,
  nameAndVersionAreTheRegistrys,
  noticesComeFromTheParameter,
} from "./attributions.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32f attributions entries", () => {
  it("A1 lists the four libraries in order", () => {
    listsTheFourLibrariesInOrder();
  });
  it("A2 core has no source, notice or credits", () => {
    coreHasNoSourceNoticeOrCredits();
  });
  it("A3 Lucide carries its licence, version and source", () => {
    lucideCarriesItsLicenceVersionAndSource();
  });
  it("A4 notices come from the parameter", () => {
    noticesComeFromTheParameter();
  });
  it("A5 name and version are the registry's", () => {
    nameAndVersionAreTheRegistrys();
  });
});
