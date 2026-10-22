import { describe, it } from "vitest";

import {
  assertCatalogCodeCarriesTheNameApartFromTheClass,
  assertCatalogCodeSlug,
  assertCellLengthProblem,
  assertCutToBound,
  assertCutToBoundWithHashSuffix,
  assertDistinctAssetDomains,
  assertDraftCountProblem,
  assertSlugCodeHashesASlugTheClassChanges,
  assertSlugCodeKeepsAnUnderscore,
  assertSlugCodeKeepsCaseDistinctSlugsApart,
  assertSlugCodeOfALongSlugIsCutInsideTheClass,
  assertSlugCodeOfAnAllIllegalSlugIsTheHashAlone,
  assertSlugCodeOfAOneWordSlug,
  assertSlugCodeOfACleanSlugTakesNoHash,
  assertW5ADraftOverTheTemplateCapIsRefused,
  assertW6ADraftAtTheTemplateCapIsAccepted,
  assertWorkbookSectionCountProblem,
} from "./onboarding-draft-caps.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("onboarding draft count caps (F4.103)", () => {
  it("refuses a workbook section with more data rows than its cap", () => {
    assertWorkbookSectionCountProblem();
  });

  it("refuses a workbook cell longer than the column it commits to (F4.104)", () => {
    assertCellLengthProblem();
  });

  it("refuses a draft array over its cap, and names the first one in schema order", () => {
    assertDraftCountProblem();
  });

  it("collapses the asset domains to one entry per distinct code, in first-appearance order", () => {
    assertDistinctAssetDomains();
  });

  it("cuts a chat-derived string on whole characters, in the units the schema counts (F4.104)", () => {
    assertCutToBound();
  });

  it("hash-suffixes a cut globally unique identifier, and only a cut one (F4.104)", () => {
    assertCutToBoundWithHashSuffix();
  });

  it("reduces a location name to the catalog code class (F2.23, ADR 0065 decision 4)", () => {
    assertCatalogCodeSlug();
  });

  it("keeps two names apart when the slug drops what differs between them", () => {
    assertCatalogCodeCarriesTheNameApartFromTheClass();
  });
});

describe("onboarding draft count caps — templates (F3.22, ADR 0091 decision 2)", () => {
  it("W5 refuses a draft over the template cap, naming templates and the cap", () => {
    assertW5ADraftOverTheTemplateCapIsRefused();
  });

  it("W6 accepts a draft at the template cap", () => {
    assertW6ADraftAtTheTemplateCapIsAccepted();
  });
});

describe("the asset code derived from the location slug (F4.136, ADR 0065 Amendment 2)", () => {
  it("a derived slug yields a readable code with no hash", () => {
    assertSlugCodeOfACleanSlugTakesNoHash();
  });

  it("a one-word slug yields its own code", () => {
    assertSlugCodeOfAOneWordSlug();
  });

  it("an underscore in the slug survives with no hash", () => {
    assertSlugCodeKeepsAnUnderscore();
  });

  it("two slugs that differ only in case get distinct codes", () => {
    assertSlugCodeKeepsCaseDistinctSlugsApart();
  });

  it("a slug the class changes is slugged and hashed", () => {
    assertSlugCodeHashesASlugTheClassChanges();
  });

  it("an all-illegal slug yields the hash alone, with no leading separator", () => {
    assertSlugCodeOfAnAllIllegalSlugIsTheHashAlone();
  });

  it("a long clean slug is cut by the length hash and stays inside the class", () => {
    assertSlugCodeOfALongSlugIsCutInsideTheClass();
  });
});
