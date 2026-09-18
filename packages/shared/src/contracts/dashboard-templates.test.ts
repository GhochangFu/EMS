import { describe, it } from "vitest";

import {
  acceptsATableWithNoSourceAndNoColumns,
  acceptsAWidgetCarryingEitherKindAlone,
  acceptsAWidgetCarryingNeitherKind,
  acceptsDeclaredColumnsOfTheBoundDataset,
  identitySchemaDescribesAllThreeRules,
  rejectsATableColumnItsDatasetDoesNotDeclare,
  rejectsAValueTileBoundToADataset,
  rejectsAWidgetCarryingBothKinds,
  rejectsAnySourceOnAChart,
  rejectsBothKindsInsideSectionTemplateContentSchema,
  rejectsTheSameColumnChosenTwice,
  rejectsTwoSourcesOnAValueTile,
  tableWithColumnsSetButNoSourceDoesNotThrow,
  widgetSchemaDescribesShapeCapAndColumnsRules,
} from "./dashboard-templates.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * One `it()` per case, so a failing case reddens only its own claim. */
describe("F3.61 — a template widget binds asset roles or catalog sources, never both", () => {
  it("case 1: rejects a widget carrying both kinds", () => {
    rejectsAWidgetCarryingBothKinds();
  });

  it("case 2: accepts a widget carrying neither kind (positive control for case 1)", () => {
    acceptsAWidgetCarryingNeitherKind();
  });

  it("case 3: accepts a widget carrying either kind alone", () => {
    acceptsAWidgetCarryingEitherKindAlone();
  });

  it("case 4: the identity schema's description names all three rules", () => {
    identitySchemaDescribesAllThreeRules();
  });

  it("case 5: rejects both kinds inside sectionTemplateContentSchema", () => {
    rejectsBothKindsInsideSectionTemplateContentSchema();
  });
});

describe("F3.61 Amendment 1 — a template widget's sources fit its shape, its cap and its dataset's columns", () => {
  it("case 6: rejects a value_tile bound to a dataset", () => {
    rejectsAValueTileBoundToADataset();
  });

  it("case 7: rejects any source on a chart", () => {
    rejectsAnySourceOnAChart();
  });

  it("case 8: rejects two sources on a value_tile", () => {
    rejectsTwoSourcesOnAValueTile();
  });

  it("case 9: rejects a table column its bound dataset does not declare", () => {
    rejectsATableColumnItsDatasetDoesNotDeclare();
  });

  it("case 10: accepts declared columns of the bound dataset", () => {
    acceptsDeclaredColumnsOfTheBoundDataset();
  });

  it("case 11: rejects the same column chosen twice", () => {
    rejectsTheSameColumnChosenTwice();
  });

  it("case 12: accepts a table with no source and no columns", () => {
    acceptsATableWithNoSourceAndNoColumns();
  });

  it("the R7 guard: a table with config.columns set but no source does not throw", () => {
    tableWithColumnsSetButNoSourceDoesNotThrow();
  });

  it("case 13: the widget schema's description names the shape, cap and columns rules", () => {
    widgetSchemaDescribesShapeCapAndColumnsRules();
  });
});
