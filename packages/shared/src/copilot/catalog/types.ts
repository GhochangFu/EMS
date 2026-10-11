import type { ZodTypeAny } from "zod";

/**
 * `F3.85` PR 8 / ADR 0099 decisions 2, 3, 4 and 6 — the shape of one action
 * catalog entry: one API write route the copilot may propose and a wizard may
 * submit.
 *
 * The catalog is data. It holds no database access: the target's organization
 * and name are resolved on the server from the declarative `target` and `refs`
 * below (`apps/api/src/copilot/copilot-target-resolver.ts`), and the summary
 * is a pure function of what the server resolved.
 */

/** How much a change can do; the Confirm card styles it, and `copilot_pending_changes_risk_check` holds the same four. */
export type CatalogRisk = "create" | "edit" | "deactivate" | "access";

export type CatalogMethod = "POST" | "PUT" | "PATCH";

/**
 * Where a change's organization comes from. Every target row is
 * `organization_id NOT NULL`, so a change always has one organization.
 *
 * - `organization`: the body's `organizationId` (a create); `manage` names
 *   the route's own authority check for it (a dashboard checks its body
 *   scope, a template the organization, a parameter its body scope);
 * - `dashboard`, `dashboardTemplate`, `calcParameter`: the row the path
 *   parameter `id` names;
 * - `asset`: the asset the path parameter `assetId` names.
 */
export type CatalogTarget =
  | { readonly kind: "organization"; readonly manage: "dashboard" | "template" | "calcParameter" }
  | { readonly kind: "dashboard" | "dashboardTemplate" | "calcParameter"; readonly param: "id" }
  | { readonly kind: "asset"; readonly param: "assetId" };

/** A body field holding the id of a row that must belong to the change's organization. */
export type CatalogRef = { readonly field: string; readonly kind: "location" | "assetGroup" | "asset" };

/** A top-level body field holding a formula, and the field holding its dialect. */
export type CatalogFormula = { readonly field: string; readonly dialectField: string };

/** One wizard step: the top-level body fields it edits. The Review step is not listed; every wizard ends with it. */
export type CatalogStep = { readonly id: string; readonly title: string; readonly fields: readonly string[] };

/** What the server resolved for one proposal; the summary reads only this. */
export type CatalogSummaryInput = {
  /** The body as the model sent it, after it passed `body`. */
  readonly body: Readonly<Record<string, unknown>>;
  readonly params: Readonly<Record<string, string>>;
  /** The target row's name (a dashboard, a template, a parameter key, an asset), or the organization's name for a create. */
  readonly targetName: string;
  readonly organizationName: string;
  /** `dashboard.widgets.replace` only: the ids of the dashboard's widgets now (decision 4.9). */
  readonly currentWidgetIds?: readonly string[];
};

export interface CatalogEntry {
  /** `area.verb`, unique. The propose tool is `propose_` + the id with `.` → `_`. */
  readonly id: string;
  /** The verb phrase a card and a wizard title show, e.g. "Create a dashboard". */
  readonly title: string;
  readonly method: CatalogMethod;
  /** The route below the global prefix, with `:param` placeholders, e.g. `/dashboards/:id/widgets`. */
  readonly path: string;
  /** One schema per path parameter, the same rule the controller parses it with. */
  readonly params: Readonly<Record<string, ZodTypeAny>>;
  /**
   * The schema the controller parses the body with — the same export, by
   * identity (`catalog.spec.ts`). A route that takes no body uses
   * `z.object({}).strict()`, and its stored and sent body is `{}`.
   */
  readonly body: ZodTypeAny;
  /** The export name of `body` in `@bms/shared`, or `null` for a route that takes no body (`tests/f3.85-catalog-coverage`). */
  readonly bodyName: string | null;
  /** Body keys the user types on the Confirm card and the model never sees (none in release 1). */
  readonly clientOnly: readonly string[];
  readonly risk: CatalogRisk;
  readonly target: CatalogTarget;
  readonly refs: readonly CatalogRef[];
  readonly formulas: readonly CatalogFormula[];
  /** The fields-only steps; a route with no body fields has none and its wizard is the Review step alone (ruling Q6). */
  readonly steps: readonly CatalogStep[];
  /** One sentence that names the target (`catalog.spec.ts` checks it). */
  summary(input: CatalogSummaryInput): string;
}

/** A write route the copilot never proposes, and why (decision 2's exclusion list). */
export type ExcludedRoute = {
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly reason: string;
};
