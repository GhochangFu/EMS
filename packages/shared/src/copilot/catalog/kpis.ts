import { assetPointCalcOverrideBodySchema, calcPointKeyParamSchema } from "../../contracts/calc-override-writes";
import { createCalcParameterBodySchema, updateCalcParameterBodySchema } from "../../contracts/calc-parameter-writes";
import { fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry } from "./types";

/**
 * `F3.85` PR 8 — the KPI writes that exist today (ruling 18): calc parameters
 * and an asset's calc override. PR 11 adds `assetTemplate.update` and
 * `assetTemplate.publish` here and builds the wizards.
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
    target: { kind: "organization" },
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
    title: "Override an asset's calculated point",
    method: "PUT",
    path: "/admin/assets/:assetId/calc-points/:pointKey",
    params: { assetId: uuidParam, pointKey: calcPointKeyParamSchema },
    body: assetPointCalcOverrideBodySchema,
    bodyName: "assetPointCalcOverrideBodySchema",
    clientOnly: [],
    risk: "edit",
    target: { kind: "asset", param: "assetId" },
    refs: [],
    formulas: [{ field: "formula", dialectField: "formulaDialect" }],
    steps: [
      { id: "formula", title: "Formula", fields: ["formula", "formulaDialect"] },
      { id: "schedule", title: "Schedule", fields: ["calcTrigger", "calcIntervalSeconds", "maxInputAgeSeconds"] },
    ],
    summary: ({ params, targetName }) =>
      `Set the calculation override of the point ${quoted(params.pointKey ?? "")} on the asset ${quoted(targetName)}.`,
  },
];
