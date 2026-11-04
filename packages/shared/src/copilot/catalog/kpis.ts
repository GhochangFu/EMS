import { assetPointCalcOverrideBodySchema, calcPointKeyParamSchema } from "../../contracts/calc-override-writes";
import { createCalcParameterBodySchema, updateCalcParameterBodySchema } from "../../contracts/calc-parameter-writes";
import { calcPointBatchBodySchema, calcPointSetBodySchema } from "../../contracts/calc-point-writes";
import { emptyBody, fieldList, plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogStep } from "./types";

/**
 * The controller's `calcPointKeyParamSchema`, less the two values a browser
 * resolves as path segments: `fetch` turns `.../calc-points/..` into
 * `.../`, so the request never matches the stored path (the interceptor
 * answers 409). Refused at propose time instead.
 */
const pointKeyParam = calcPointKeyParamSchema.refine((key) => key !== "." && key !== "..", {
  message: "a point key cannot be . or ..",
});

/** The steps a calc write shares: the formula and its timing (`calcOverride.set`'s, unchanged). */
const FORMULA_STEP: CatalogStep = { id: "formula", title: "Formula", fields: ["formula", "formulaDialect"] };
const SCHEDULE_STEP: CatalogStep = {
  id: "schedule",
  title: "Schedule",
  fields: ["calcTrigger", "calcIntervalSeconds", "maxInputAgeSeconds"],
};
/** ADR 0109 decision 7: days of history to compute on save (the run is `F4.311` PR 5's). */
const BACKFILL_STEP: CatalogStep = { id: "backfill", title: "Backfill", fields: ["backfillDays"] };

/** The card's history line, when the body asks for a backfill. */
function backfillLine(body: Readonly<Record<string, unknown>>): string {
  return typeof body.backfillDays === "number" ? ` It computes the last ${plural(body.backfillDays, "day")} of history.` : "";
}

/**
 * `F3.85` PR 8 — the KPI writes that exist today (ruling 18): calc parameters
 * and an asset's calc override. `assetTemplate.update` and
 * `assetTemplate.publish` (PR 11a) moved to `asset-templates.ts` in
 * `F4.254` PR 1.
 *
 * `F4.311` PR 3 (ADR 0099 Amendment 11, ADR 0109 decision 6): the standalone
 * calculated points — `calcPoint.set`, `calcPoint.createBatch` and
 * `calcPoint.delete`, each a red card. `calcPoint.set` and `calcOverride.set`
 * share a path with different bodies: the route dispatches on the asset's
 * kind, so each entry's target admits only the kind its body is for (G2), and
 * the propose tool picks by entry id.
 */
export const KPI_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "calcParameter.create",
    title: "Add a calculation parameter",
    method: "POST",
    path: "/admin/calc-parameters",
    params: {},
    body: createCalcParameterBodySchema,
    bodyName: "createCalcParameterBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "organization", manage: "calcParameter" },
    refs: [
      { field: "locationId", kind: "location" },
      { field: "assetId", kind: "asset" },
    ],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["key", "value"] },
      { id: "scope", title: "Scope", fields: ["organizationId", "locationId", "assetId"] },
      { id: "window", title: "Effective dates", fields: ["effectiveFrom", "effectiveTo"] },
    ],
    summary: ({ body, organizationName }) =>
      `Add the calculation parameter ${quoted(text(body, "key"))} = ${String(body.value)} in ${organizationName}.`,
  },
  {
    id: "calcParameter.update",
    title: "Edit a calculation parameter",
    method: "PATCH",
    path: "/admin/calc-parameters/:id",
    params: { id: uuidParam },
    body: updateCalcParameterBodySchema,
    bodyName: "updateCalcParameterBodySchema",
    clientOnly: [],
    risk: "edit",
    target: { kind: "calcParameter", param: "id" },
    refs: [],
    formulas: [],
    steps: [
      { id: "value", title: "Value", fields: ["value"] },
      { id: "window", title: "Effective dates", fields: ["effectiveFrom", "effectiveTo"] },
    ],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the calculation parameter ${quoted(targetName)}.`,
  },
  {
    id: "calcOverride.set",
    title: "Override a calculated point on an asset built from a template",
    method: "PUT",
    path: "/admin/assets/:assetId/calc-points/:pointKey",
    params: { assetId: uuidParam, pointKey: pointKeyParam },
    body: assetPointCalcOverrideBodySchema,
    bodyName: "assetPointCalcOverrideBodySchema",
    clientOnly: [],
    risk: "edit",
    // Amendment 11 G2: only an asset pinned to a template; on any other the route writes a standalone point.
    target: { kind: "asset", param: "assetId", template: "pinned" },
    refs: [],
    formulas: [{ field: "formula", dialectField: "formulaDialect" }],
    steps: [FORMULA_STEP, SCHEDULE_STEP],
    summary: ({ params, targetName }) =>
      `Set the calculation override of the point ${quoted(params.pointKey ?? "")} on the asset ${quoted(targetName)}.`,
  },
  {
    id: "calcPoint.set",
    title: "Set a calculated point on an asset with no template",
    method: "PUT",
    path: "/admin/assets/:assetId/calc-points/:pointKey",
    params: { assetId: uuidParam, pointKey: pointKeyParam },
    body: calcPointSetBodySchema,
    bodyName: "calcPointSetBodySchema",
    clientOnly: [],
    risk: "create",
    red: true,
    target: { kind: "asset", param: "assetId", template: "none" },
    refs: [],
    formulas: [{ field: "formula", dialectField: "formulaDialect" }],
    steps: [FORMULA_STEP, SCHEDULE_STEP, BACKFILL_STEP],
    summary: ({ body, params, targetName }) =>
      `Set the calculated point ${quoted(params.pointKey ?? "")} on the asset ${quoted(targetName)} to ` +
      `${text(body, "formula")}.${backfillLine(body)}`,
  },
  {
    id: "calcPoint.createBatch",
    title: "Add a calculated point to several assets with no template",
    method: "POST",
    path: "/admin/calc-points/batch",
    params: {},
    body: calcPointBatchBodySchema,
    bodyName: "calcPointBatchBodySchema",
    clientOnly: [],
    risk: "create",
    red: true,
    // `CatalogRef` names one id per field; the target checks every id of `assetIds` itself (G3).
    target: { kind: "calcPointBatch", field: "assetIds" },
    refs: [],
    formulas: [{ field: "formula", dialectField: "formulaDialect" }],
    steps: [
      { id: "assets", title: "Assets", fields: ["assetIds"] },
      { id: "point", title: "Point", fields: ["pointKey"] },
      FORMULA_STEP,
      SCHEDULE_STEP,
      BACKFILL_STEP,
    ],
    summary: ({ body, organizationName }) => {
      const assets = Array.isArray(body.assetIds) ? body.assetIds.length : 0;
      return (
        `Set the calculated point ${quoted(text(body, "pointKey"))} to ${text(body, "formula")} on ` +
        `${plural(assets, "asset")} in ${organizationName}, all or none.${backfillLine(body)}`
      );
    },
  },
  {
    id: "calcPoint.delete",
    title: "Remove a calculated point from an asset with no template",
    method: "DELETE",
    path: "/admin/assets/:assetId/calc-points/:pointKey",
    params: { assetId: uuidParam, pointKey: pointKeyParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "deactivate",
    red: true,
    // Amendment 11 G4: a template-less asset only; clearing an override stays manual.
    target: { kind: "asset", param: "assetId", template: "none" },
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ params, targetName }) =>
      `Remove the calculated point ${quoted(params.pointKey ?? "")} from the asset ${quoted(targetName)}: ` +
      "it stops computing, and its stored readings stay.",
  },
];
