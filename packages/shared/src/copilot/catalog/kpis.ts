import { assetPointCalcOverrideBodySchema, calcPointKeyParamSchema } from "../../contracts/calc-override-writes";
import { updateAssetTemplateBodySchema } from "../../contracts/asset-template-writes";
import { createCalcParameterBodySchema, updateCalcParameterBodySchema } from "../../contracts/calc-parameter-writes";
import { emptyBody, fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogTarget } from "./types";

const ASSET_TEMPLATE: CatalogTarget = { kind: "assetTemplate", param: "id" };

/**
 * The names a template formula may reference are the template's points: the
 * body's `points` when the PATCH replaces them, else the stored ones the
 * resolver reads. A KPI's own `pointKeys` is cross-checked against its
 * expression by the body schema; whether those keys exist on the template is
 * the route's `assertContentRefsResolve`, which the propose tool mirrors here.
 */
const TEMPLATE_POINT_KEYS = "points[].pointKey";

/**
 * The controller's `calcPointKeyParamSchema`, less the two values a browser
 * resolves as path segments: `fetch` turns `.../calc-points/..` into
 * `.../`, so the request never matches the stored path (the interceptor
 * answers 409). Refused at propose time instead.
 */
const pointKeyParam = calcPointKeyParamSchema.refine((key) => key !== "." && key !== "..", {
  message: "a point key cannot be . or ..",
});

/**
 * `F3.85` PR 8 — the KPI writes that exist today (ruling 18): calc parameters
 * and an asset's calc override. PR 11a adds `assetTemplate.update` and
 * `assetTemplate.publish`.
 *
 * `assetTemplate.update`'s body is the shared update body by identity; the
 * controller parses the api wrapper that adds the cycle check
 * (`asset-templates.schema.ts`, `_def.schema` is this export), so a cyclic
 * proposal is refused on Confirm. Its `content` step comes first: the KPIs
 * tab's wizard opens on it. Ruling Q10: a proposal that names `content` is
 * stored merged over the template's current content, section by section.
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
    title: "Override an asset's calculated point",
    method: "PUT",
    path: "/admin/assets/:assetId/calc-points/:pointKey",
    params: { assetId: uuidParam, pointKey: pointKeyParam },
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
  {
    id: "assetTemplate.update",
    title: "Edit an asset template",
    method: "PATCH",
    path: "/admin/asset-templates/:id",
    params: { id: uuidParam },
    body: updateAssetTemplateBodySchema,
    bodyName: "updateAssetTemplateBodySchema",
    clientOnly: [],
    risk: "edit",
    target: ASSET_TEMPLATE,
    refs: [],
    formulas: [
      { field: "points[].formula", dialectField: "points[].formulaDialect", refsField: TEMPLATE_POINT_KEYS },
      { field: "content.kpis[].expression", dialectField: "content.kpis[].dialect", refsField: TEMPLATE_POINT_KEYS },
    ],
    steps: [
      { id: "content", title: "KPIs and content", fields: ["content"] },
      { id: "points", title: "Points", fields: ["points"] },
      { id: "details", title: "Details", fields: ["name", "assetType", "domain", "description"] },
    ],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the asset template ${quoted(targetName)}.`,
  },
  {
    id: "assetTemplate.publish",
    title: "Publish an asset template",
    method: "POST",
    path: "/admin/asset-templates/:id/publish",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "edit",
    target: ASSET_TEMPLATE,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Publish the asset template ${quoted(targetName)}.`,
  },
];
