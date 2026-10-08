import { describe, it } from "vitest";

import {
  assertARetiredGatewayIsNotPreFilled,
  assertATemplateSharedByTwoAssetsIsListedOnce,
  assertBufferHasNoFormulaCells,
  assertExistingRowsAreWrittenAsStored,
  assertPreFillRowsFromTheTemplate,
  assertPreFillSubstitutesStoredVariables,
  assertRowsAreSorted,
  assertTemplatesSheetListsMeasuredPointsOfTemplatesInUse,
  assertTheBufferIsDeflatedAndStillParses,
  assertTheWorkbookCarriesTemplatesSecondAndParsesAsMappings,
  assertATemplateWithNoIdentityIsSkipped,
  assertTemplateVersionsSortNumerically,
} from "./mapping-sheet-export.spec";

/** `F2.7` G3 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — the MAPPINGS export row set (ADR 0056 decision 6)", () => {
  it("writes the header and every non-computed row of an active asset as stored, TRUE/FALSE for active", () => {
    assertExistingRowsAreWrittenAsStored();
  });

  it("pre-fills a measured template point with no row: {asset_code} substituted, other tokens literal, active blank", () => {
    assertPreFillRowsFromTheTemplate();
  });

  it("F2.29 — pre-fills with every variable the asset stores; a NULL-variables asset keeps the token literal", () => {
    assertPreFillSubstitutesStoredVariables();
  });

  it("sorts by asset code then point key", () => {
    assertRowsAreSorted();
  });

  it("produces a buffer with no formula cell — a formula-looking code is a string (ADR 0026)", () => {
    assertBufferHasNoFormulaCells();
  });

  it(
    "deflates the workbook so a large export stays under the import's own file cap, and it still parses",
    () => {
      assertTheBufferIsDeflatedAndStillParses();
    },
    // A 2,000-row workbook is built, written and read back here.
    20_000,
  );

  it("leaves rtu_code blank on a pre-fill row whose asset sits on a retired gateway, and keeps it on a stored row", () => {
    assertARetiredGatewayIsNotPreFilled();
  });

  it("F2.26 — lists the measured points of each template version an active asset pins, pattern literal, defaults as numbers, sorted", () => {
    assertTemplatesSheetListsMeasuredPointsOfTemplatesInUse();
  });

  it("F2.26 — lists a template version shared by two active assets once", () => {
    assertATemplateSharedByTwoAssetsIsListedOnce();
  });

  it("F2.26 — writes MAPPINGS then TEMPLATES, no formula cell, and the workbook still parses as its MAPPINGS rows", () => {
    assertTheWorkbookCarriesTemplatesSecondAndParsesAsMappings();
  });

  it("F2.26 — sorts template versions numerically: v2 before v10", () => {
    assertTemplateVersionsSortNumerically();
  });

  it("F2.26 — skips a pinned template id with no template identity and lists the rest", () => {
    assertATemplateWithNoIdentityIsSkipped();
  });
});
