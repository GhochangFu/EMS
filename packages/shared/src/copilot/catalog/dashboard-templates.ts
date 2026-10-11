import { z } from "zod";

import {
  createDashboardTemplateBodySchema,
  importStockTemplateBodySchema,
  instantiateSectionTemplateBodySchema,
  updateDashboardTemplateBodySchema,
} from "../../contracts/dashboard-template-writes";
import { emptyBody, fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry } from "./types";

/** The stock code path parameter, the same rule as the API's `stockCodeParamSchema` (`admin/admin.schema.ts`). */
export const stockCodeParam = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "a stock code is lowercase letters, digits and hyphens");

const TEMPLATE = { kind: "dashboardTemplate", param: "id" } as const;

/** `F3.85` PR 8 — the dashboard template writes (`DashboardTemplatesController`). PR 10 builds their wizards. */
export const DASHBOARD_TEMPLATE_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "dashboardTemplate.create",
    title: "Create a dashboard template",
    method: "POST",
    path: "/admin/dashboard-templates",
    params: {},
    body: createDashboardTemplateBodySchema,
    bodyName: "createDashboardTemplateBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "organization" },
    refs: [],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["organizationId", "code", "name", "section", "target", "description"] },
      { id: "content", title: "Content", fields: ["content"] },
    ],
    summary: ({ body, organizationName }) =>
      `Create the dashboard template ${quoted(text(body, "name"))} (${text(body, "code")}) in ${organizationName}.`,
  },
  {
    id: "dashboardTemplate.update",
    title: "Edit a dashboard template",
    method: "PATCH",
    path: "/admin/dashboard-templates/:id",
    params: { id: uuidParam },
    body: updateDashboardTemplateBodySchema,
    bodyName: "updateDashboardTemplateBodySchema",
    clientOnly: [],
    risk: "edit",
    target: TEMPLATE,
    refs: [],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["name", "section", "description"] },
      { id: "content", title: "Content", fields: ["content"] },
    ],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the dashboard template ${quoted(targetName)}.`,
  },
  {
    id: "dashboardTemplate.publish",
    title: "Publish a dashboard template",
    method: "POST",
    path: "/admin/dashboard-templates/:id/publish",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "edit",
    target: TEMPLATE,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Publish the dashboard template ${quoted(targetName)}.`,
  },
  {
    id: "dashboardTemplate.archive",
    title: "Archive a dashboard template",
    method: "POST",
    path: "/admin/dashboard-templates/:id/archive",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "deactivate",
    target: TEMPLATE,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Archive the dashboard template ${quoted(targetName)}. It can no longer be instantiated.`,
  },
  {
    id: "dashboardTemplate.draft",
    title: "Start a new draft of a dashboard template",
    method: "POST",
    path: "/admin/dashboard-templates/:id/draft",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "create",
    target: TEMPLATE,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Start a new draft of the dashboard template ${quoted(targetName)}.`,
  },
  {
    id: "dashboardTemplate.instantiate",
    title: "Make a dashboard from a template",
    method: "POST",
    path: "/admin/dashboard-templates/:id/instantiate",
    params: { id: uuidParam },
    body: instantiateSectionTemplateBodySchema,
    bodyName: "instantiateSectionTemplateBodySchema",
    clientOnly: [],
    risk: "create",
    target: TEMPLATE,
    refs: [
      { field: "assetGroupId", kind: "assetGroup" },
      { field: "locationId", kind: "location" },
    ],
    formulas: [],
    steps: [
      { id: "target", title: "Target", fields: ["assetGroupId", "locationId", "tabGroups"] },
      { id: "details", title: "Details", fields: ["name", "slug", "description"] },
    ],
    summary: ({ body, targetName }) =>
      "locationId" in body
        ? `Make the site layout of the template ${quoted(targetName)} for one site.`
        : `Make the dashboard ${quoted(text(body, "name"))} from the template ${quoted(targetName)}.`,
  },
  {
    id: "dashboardTemplate.importStock",
    title: "Import a stock dashboard template",
    method: "POST",
    path: "/admin/dashboard-templates/stock/:code/import",
    params: { code: stockCodeParam },
    body: importStockTemplateBodySchema,
    bodyName: "importStockTemplateBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "organization" },
    refs: [],
    formulas: [],
    steps: [{ id: "organization", title: "Organization", fields: ["organizationId"] }],
    summary: ({ params, organizationName }) =>
      `Import the stock dashboard template ${quoted(params.code ?? "")} into ${organizationName}.`,
  },
  {
    id: "dashboardTemplate.applyToSites",
    title: "Apply a site template to every site",
    method: "POST",
    path: "/admin/dashboard-templates/:id/apply-to-sites",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "create",
    target: TEMPLATE,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName, organizationName }) =>
      `Make the site layout of the template ${quoted(targetName)} for every active site in ${organizationName}.`,
  },
];
