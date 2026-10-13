import { updateAssetTemplateBodySchema } from "../../contracts/asset-template-writes";
import { emptyBody, fieldList, quoted, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogTarget, ExcludedRoute } from "./types";

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
 * `F4.254` PR 1 (ADR 0099 decision 3) — the asset-template routes. One file per
 * area, so the later `F4.254` PRs edit this file and nothing in `kpis.ts`.
 * `assetTemplate.update` and `assetTemplate.publish` moved here from `kpis.ts`
 * unchanged (`F3.85` PR 11a, plan §10.1).
 *
 * `assetTemplate.update`'s body is the shared update body by identity; the
 * controller parses the api wrapper that adds the cycle check
 * (`asset-templates.schema.ts`, `_def.schema` is this export), so a cyclic
 * proposal is refused on Confirm. Its `content` step comes first: the KPIs
 * tab's wizard opens on it. Ruling Q10: a proposal that names `content` is
 * stored merged over the template's current content, section by section.
 *
 * Catalog order, fixed now (the coverage gate's positive control depends on
 * it): create, update, publish, archive, draft, importStock, instantiate. The
 * five lifecycle routes are entries in `F4.254` PRs 2 and 3.
 */
export const ASSET_TEMPLATE_ENTRIES: readonly CatalogEntry[] = [
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

const MANY_LIVE_ROWS =
  "re-pins up to 200 live assets and inserts their points in one transaction with no undo route (ADR 0039); decision 3 does not name it — manual";
const OVERWRITES_TUNED =
  "overwrites the tuned alarm values of up to 500 live rules with no undo route (ADR 0058 decision 8); decision 3 does not name it — manual";
const PARTIAL_COMMIT =
  "commits one transaction per chunk, so a failed call leaves earlier chunks applied (ADR 0067 Q7); decision 3 does not name it — manual";
const WRITES_NOTHING =
  "a read through POST: it writes nothing (ADR 0039 decision 2); precedent: onboarding /validate";

/**
 * The area's write routes that are not entries. Four stay manual for good
 * (`F4.254` rulings 2 and 3); the five lifecycle routes carry the PR that makes
 * each an entry as the reason (the release-2 trick, `F3.86` plan §4.5), which
 * keeps `tests/f3.85-catalog-coverage` green between PRs.
 */
export const ASSET_TEMPLATE_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/asset-templates/:id/migrate", reason: MANY_LIVE_ROWS },
  { method: "POST", path: "/admin/asset-templates/:id/seeded-rules/reapply", reason: OVERWRITES_TUNED },
  { method: "POST", path: "/admin/asset-templates/:id/default-dashboards", reason: PARTIAL_COMMIT },
  { method: "POST", path: "/admin/asset-templates/:id/migration-preview", reason: WRITES_NOTHING },
  { method: "POST", path: "/admin/asset-templates", reason: "F4.254 PR 2" },
  { method: "POST", path: "/admin/asset-templates/:id/archive", reason: "F4.254 PR 2" },
  { method: "POST", path: "/admin/asset-templates/:id/draft", reason: "F4.254 PR 2" },
  { method: "POST", path: "/admin/asset-templates/stock/:code/import", reason: "F4.254 PR 2" },
  { method: "POST", path: "/admin/asset-templates/:id/instantiate", reason: "F4.254 PR 3" },
];
