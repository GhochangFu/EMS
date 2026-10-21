import { instantiateAssetsBodySchema } from "../../contracts/asset-template-instantiate-writes";
import { createAssetTemplateBodySchema, updateAssetTemplateBodySchema } from "../../contracts/asset-template-writes";
import { importStockTemplateBodySchema } from "../../contracts/dashboard-template-writes";
import { stockCodeParam } from "./dashboard-templates";
import { emptyBody, fieldList, plural, quoted, text, uuidParam } from "./summary-text";
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

/** The two formula sites a template body carries (create and update alike). */
const TEMPLATE_FORMULAS = [
  { field: "points[].formula", dialectField: "points[].formulaDialect", refsField: TEMPLATE_POINT_KEYS },
  { field: "content.kpis[].expression", dialectField: "content.kpis[].dialect", refsField: TEMPLATE_POINT_KEYS },
] as const;

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
 * it): create, update, publish, archive, draft, importStock, instantiate.
 *
 * `F4.254` PR 2 (ADR 0099 decision 3, owner rulings 2026-10-13) — the four
 * authoring entries. `create` is one step: the list page's form has six
 * inputs, and points and content are authored on the detail tabs after the
 * draft exists; a `content` or `points` the copilot fills is shown on that
 * step, not typed. Its body is the shared create body by identity and the
 * controller parses the api wrapper with the cycle check, as `update` does,
 * so a cyclic proposal stores and is refused on Confirm. `archive` is red
 * (`deactivate`, the `dashboardTemplate.archive` precedent). `importStock`
 * parses the same shared body the dashboard import does and reuses its
 * `stockCodeParam`. Both organization-scoped entries ask the route's
 * `assertCanAuthor` (`canManageTemplate`), so a `location_admin` is never
 * offered one.
 *
 * `F4.254` PR 3 — `assetTemplate.instantiate`. Its body is the shared
 * instantiate body by identity (one refined object ending in a `.transform`):
 * the propose tool stores and hashes the raw body and the interceptor hashes
 * `req.body`, so the transform's `{ target }` reaches neither. Its target is
 * `assetTemplateDeploy` — the route's deploy authority, which admits a
 * `location_admin` on a site it manages. The summary names the target by id:
 * `CatalogSummaryInput` carries names for the template and organization only.
 */
export const ASSET_TEMPLATE_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "assetTemplate.create",
    title: "Create an asset template",
    method: "POST",
    path: "/admin/asset-templates",
    params: {},
    body: createAssetTemplateBodySchema,
    bodyName: "createAssetTemplateBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "organization", manage: "template" },
    refs: [],
    formulas: [...TEMPLATE_FORMULAS],
    steps: [
      {
        id: "basics",
        title: "Basics",
        fields: ["organizationId", "code", "name", "assetType", "domain", "description", "content", "points"],
      },
    ],
    summary: ({ body, organizationName }) =>
      `Create the asset template ${quoted(text(body, "name"))} (${text(body, "code")}) in ${organizationName}.`,
  },
  {
    id: "assetTemplate.update",
    title: "Edit an asset template",
    method: "PATCH",
    path: "/admin/asset-templates/:id",
    params: { id: uuidParam },
    body: updateAssetTemplateBodySchema,
    bodyName: "updateAssetTemplateBodySchema",
    precondition: "updatedAt",
    clientOnly: [],
    risk: "edit",
    target: ASSET_TEMPLATE,
    refs: [],
    formulas: [...TEMPLATE_FORMULAS],
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
  {
    id: "assetTemplate.archive",
    title: "Archive an asset template",
    method: "POST",
    path: "/admin/asset-templates/:id/archive",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "deactivate",
    target: ASSET_TEMPLATE,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) =>
      `Archive the asset template ${quoted(targetName)}. It can no longer be instantiated; assets that pin it keep working.`,
  },
  {
    id: "assetTemplate.draft",
    title: "Start a new draft of an asset template",
    method: "POST",
    path: "/admin/asset-templates/:id/draft",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "create",
    target: ASSET_TEMPLATE,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Start a new draft of the asset template ${quoted(targetName)}.`,
  },
  {
    id: "assetTemplate.importStock",
    title: "Import a stock asset template",
    method: "POST",
    path: "/admin/asset-templates/stock/:code/import",
    params: { code: stockCodeParam },
    body: importStockTemplateBodySchema,
    bodyName: "importStockTemplateBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "organization", manage: "template" },
    refs: [],
    formulas: [],
    steps: [{ id: "organization", title: "Organization", fields: ["organizationId"] }],
    summary: ({ params, organizationName }) =>
      `Import the stock asset template ${quoted(params.code ?? "")} into ${organizationName}.`,
  },
  {
    id: "assetTemplate.instantiate",
    title: "Build assets from an asset template",
    method: "POST",
    path: "/admin/asset-templates/:id/instantiate",
    params: { id: uuidParam },
    body: instantiateAssetsBodySchema,
    bodyName: "instantiateAssetsBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "assetTemplateDeploy", param: "id" },
    refs: [
      { field: "rtuId", kind: "rtu" },
      { field: "locationId", kind: "location" },
    ],
    formulas: [],
    steps: [
      { id: "target", title: "Target", fields: ["rtuId", "locationId"] },
      { id: "assets", title: "Assets", fields: ["assets"] },
    ],
    summary: ({ body, targetName, organizationName }) => {
      const count = Array.isArray(body.assets) ? body.assets.length : 0;
      const rtuId = text(body, "rtuId");
      const where = rtuId !== "" ? `under the RTU ${rtuId}` : `at the location ${text(body, "locationId")}`;
      return `Build ${plural(count, "asset")} from the asset template ${quoted(targetName)} ${where} in ${organizationName}.`;
    },
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
 * The area's write routes that are not entries: four stay manual for good
 * (`F4.254` rulings 2 and 3). The four authoring routes left this list in
 * `F4.254` PR 2, and the instantiate route in PR 3.
 */
export const ASSET_TEMPLATE_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/asset-templates/:id/migrate", reason: MANY_LIVE_ROWS },
  { method: "POST", path: "/admin/asset-templates/:id/seeded-rules/reapply", reason: OVERWRITES_TUNED },
  { method: "POST", path: "/admin/asset-templates/:id/default-dashboards", reason: PARTIAL_COMMIT },
  { method: "POST", path: "/admin/asset-templates/:id/migration-preview", reason: WRITES_NOTHING },
];
