import { ASSET_GROUP_ENTRIES, ASSET_GROUP_PENDING } from "./asset-groups";
import { ASSET_ROLE_ENTRIES, ASSET_ROLE_PENDING } from "./asset-roles";
import { MIMIC_LAYOUT_ENTRIES, MIMIC_LAYOUT_PENDING } from "./mimic-layouts";
import { MIMIC_SYMBOL_LIBRARY_ENTRIES, MIMIC_SYMBOL_LIBRARY_PENDING } from "./mimic-symbol-libraries";
import { ASSET_POINT_ENTRIES, ASSET_POINT_PENDING } from "./asset-points";
import { ASSET_TEMPLATE_ENTRIES, ASSET_TEMPLATE_PENDING } from "./asset-templates";
import { ASSET_ENTRIES, ASSET_PENDING } from "./assets";
import { DASHBOARD_TEMPLATE_ENTRIES } from "./dashboard-templates";
import { DASHBOARD_ENTRIES } from "./dashboards";
import { KPI_ENTRIES } from "./kpis";
import { LOCATION_TYPE_ENTRIES, LOCATION_TYPE_PENDING } from "./location-types";
import { LOCATION_ENTRIES, LOCATION_PENDING } from "./locations";
import { NOTIFICATION_ENTRIES, NOTIFICATION_PENDING } from "./notifications";
import { REPORT_ENTRIES, REPORT_PENDING } from "./reports";
import { ONBOARDING_ENTRIES, ONBOARDING_PENDING } from "./onboarding";
import { POINT_KEY_ENTRIES, POINT_KEY_PENDING } from "./point-keys";
import { RTU_ENTRIES, RTU_PENDING } from "./rtus";
import { RULE_ENTRIES, RULE_PENDING } from "./rules";
import { SITE_VIEW_ENTRIES, SITE_VIEW_PENDING } from "./site-views";
import type { CatalogEntry, CatalogFormula, ExcludedRoute } from "./types";
import { USER_ENTRIES, USER_PENDING } from "./users";

/**
 * `F3.85` PR 8 / ADR 0099 decision 2 — the action catalog: every write route
 * the copilot may propose. One file per area, so PRs 9, 10 and 11 (release 1)
 * and the `F3.86` wizard PRs (release 2, plan §4.5) never edit the same file.
 *
 * `tests/f3.85-catalog-coverage.test.ts` walks the in-release controllers and
 * requires every write route to be here or in {@link EXCLUDED_ROUTES}, and
 * each of both lists to name a route that exists.
 */
export const COPILOT_CATALOG: readonly CatalogEntry[] = [
  ...DASHBOARD_ENTRIES,
  ...DASHBOARD_TEMPLATE_ENTRIES,
  ...KPI_ENTRIES,
  ...ASSET_TEMPLATE_ENTRIES,
  ...LOCATION_ENTRIES,
  ...SITE_VIEW_ENTRIES,
  ...RTU_ENTRIES,
  ...ASSET_ENTRIES,
  ...ASSET_POINT_ENTRIES,
  ...ASSET_GROUP_ENTRIES,
  ...POINT_KEY_ENTRIES,
  ...USER_ENTRIES,
  ...ONBOARDING_ENTRIES,
  ...MIMIC_LAYOUT_ENTRIES,
  ...MIMIC_SYMBOL_LIBRARY_ENTRIES,
  ...ASSET_ROLE_ENTRIES,
  ...LOCATION_TYPE_ENTRIES,
  // `F4.278` (Amendment 8): the alarm rules.
  ...RULE_ENTRIES,
  // `F4.279` (Amendment 8): notification channels, escalation, and the rule channel set (D8).
  ...NOTIFICATION_ENTRIES,
  // F4.280 (Amendment 8): the report schedules and the on-demand file save.
  ...REPORT_ENTRIES,
];

/**
 * `F3.86` PR 2 / ADR 0099 decision 3, ruling 19 — the only `DELETE` routes a
 * catalog entry may name: revoking a grant and removing an asset-group member,
 * each with its own red Confirm. Every other `DELETE` stays manual.
 */
export const DELETE_ALLOWANCE: readonly { readonly method: "DELETE"; readonly path: string }[] = [
  { method: "DELETE", path: "/admin/users/:id/grants/:kind/:grantId" },
  { method: "DELETE", path: "/admin/asset-group-members/:id" },
];

const NO_DELETE = "a hard DELETE is never in the catalog (decision 3)";
const COPILOT_OWN = "the copilot's own route: a proposal must never change the copilot itself";

/** Write routes the copilot never proposes (decision 2), with the reason. Paths are below the global prefix. */
export const EXCLUDED_ROUTES: readonly ExcludedRoute[] = [
  // The AI key routes: a key never goes through the copilot (ADR 0022).
  { method: "PUT", path: "/admin/organizations/:orgId/ai-assistant", reason: "an AI key route" },
  { method: "DELETE", path: "/admin/organizations/:orgId/ai-assistant", reason: "an AI key route" },
  { method: "POST", path: "/admin/organizations/:orgId/ai-assistant/test", reason: "an AI key route" },
  // The copilot's own access, usage, conversation, turn and reject routes.
  { method: "PUT", path: "/admin/organizations/:orgId/copilot-access", reason: COPILOT_OWN },
  { method: "POST", path: "/copilot/conversations", reason: COPILOT_OWN },
  { method: "POST", path: "/copilot/conversations/:id/turns", reason: COPILOT_OWN },
  // `F3.86` PR 5: starting and ending the onboarding skill in a conversation (decision 7).
  { method: "POST", path: "/copilot/conversations/:id/skills/onboarding", reason: COPILOT_OWN },
  { method: "DELETE", path: "/copilot/conversations/:id/skills/onboarding", reason: COPILOT_OWN },
  { method: "POST", path: "/copilot/changes/:id/reject", reason: COPILOT_OWN },
  // A temporary password is typed by a person, never proposed.
  { method: "POST", path: "/admin/users/:id/temporary-password", reason: "a credential route" },
  // Every DELETE in the in-release controllers.
  { method: "DELETE", path: "/dashboards/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/admin/dashboard-templates/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/admin/asset-templates/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/admin/calc-parameters/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/admin/assets/:assetId/calc-points/:pointKey", reason: NO_DELETE },
  // `F3.87` (Amendment 3 A1): the layout DELETE. The unit-role edit and retire are entries since
  // `F4.282` (Amendment 8, Q17 withdraws A1's exclusion).
  { method: "DELETE", path: "/mimic-layouts/:id", reason: NO_DELETE },
  // `F3.86`: each area's routes that are not (yet) entries.
  ...ASSET_TEMPLATE_PENDING,
  ...LOCATION_PENDING,
  ...SITE_VIEW_PENDING,
  ...RTU_PENDING,
  ...ASSET_PENDING,
  ...ASSET_POINT_PENDING,
  ...ASSET_GROUP_PENDING,
  ...POINT_KEY_PENDING,
  ...USER_PENDING,
  ...ONBOARDING_PENDING,
  // `F3.87`: the mimic areas, each route pending until its PR.
  ...MIMIC_LAYOUT_PENDING,
  ...MIMIC_SYMBOL_LIBRARY_PENDING,
  ...ASSET_ROLE_PENDING,
  ...LOCATION_TYPE_PENDING,
  ...RULE_PENDING,
  ...NOTIFICATION_PENDING,
  // F4.280 (Amendment 8): the two report DELETEs stay manual.
  ...REPORT_PENDING,
];

/** The API's global prefix; a stored change's path starts with it (`copilotPendingChangeDtoSchema`). */
export const COPILOT_API_PREFIX = "/api/v1";

const BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(COPILOT_CATALOG.map((entry) => [entry.id, entry]));

/** The catalog entry with this id, or `undefined`. */
export function catalogEntry(id: string): CatalogEntry | undefined {
  return BY_ID.get(id);
}

/**
 * `F3.87` PR 2 — the body keys the change's hash leaves out: the entry's
 * `clientOnly` keys (typed on the card) and its `cardOnly` keys (stored for
 * the card alone). An unknown entry leaves out nothing, the strict direction.
 */
export function hashExcludedKeysFor(catalogId: string): readonly string[] {
  const entry = BY_ID.get(catalogId);
  return entry ? hashExcludedKeysOf(entry) : [];
}

const NO_CARD_ONLY_KEYS: readonly string[] = Object.freeze([]);

/**
 * `F3.87` PR 5 — the body keys the server stored for the card alone (a
 * layout's `baseline`, PR 6's `svgText`): the browser strips them before it
 * sends the write, whose strict schema would refuse them. An unknown entry
 * strips nothing; its hash then leaves nothing out either, so the two agree.
 * An entry with no `cardOnly` gets one frozen empty array, so a caller's memo
 * keyed on the result stays stable across renders.
 */
export function cardOnlyKeysFor(catalogId: string): readonly string[] {
  return BY_ID.get(catalogId)?.cardOnly ?? NO_CARD_ONLY_KEYS;
}

/** The same rule for an entry in hand: the propose tool hashes with it, so the two sides cannot drift. */
export function hashExcludedKeysOf(entry: Pick<CatalogEntry, "clientOnly" | "cardOnly">): readonly string[] {
  return [...entry.clientOnly, ...(entry.cardOnly ?? [])];
}

/**
 * `F3.87` PR 2 / owner ruling Q1 (2026-10-15) — the entries whose web form is
 * the layout editor's canvas, not a stepper: they have no steps, and
 * `tests/f3.85-stepper-coverage` takes each from the editor page instead of a
 * `WizardShell`.
 */
export const CANVAS_ENTRY_IDS = ["mimicLayout.create", "mimicLayout.replace"] as const;

/** The propose tool's name: provider tool names allow `[A-Za-z0-9_-]` only, so the id's dots become underscores. */
export function proposeToolName(entry: Pick<CatalogEntry, "id">): string {
  return `propose_${entry.id.replace(/\./g, "_")}`;
}

/** The path parameter names of a route template, in order. */
export function pathParamsOf(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1] as string);
}

/**
 * The decoded path parameters of a stored path, read back against the entry's
 * template (the inverse of {@link catalogPath}); `null` when the path is not
 * one of the entry's.
 */
export function catalogParamsOf(entry: Pick<CatalogEntry, "path">, path: string): Record<string, string> | null {
  const names = pathParamsOf(entry.path);
  const pattern = new RegExp(
    `^${COPILOT_API_PREFIX}${entry.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:([A-Za-z]+)/g, "([^/]+)")}$`,
  );
  const match = pattern.exec(path);
  if (!match) return null;
  const params: Record<string, string> = {};
  try {
    names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] as string);
    });
  } catch {
    return null;
  }
  return params;
}

/**
 * The stored path of a change: the global prefix and the template with each
 * parameter `encodeURIComponent`-encoded — exactly the raw `req.path` the
 * interceptor compares, and what the browser's `fetch` sends unchanged.
 */
export function catalogPath(entry: Pick<CatalogEntry, "path">, params: Readonly<Record<string, string>>): string {
  return (
    COPILOT_API_PREFIX +
    entry.path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
      const value = params[name];
      if (value === undefined) throw new Error(`F3.85: the path parameter "${name}" is missing`);
      return encodeURIComponent(value);
    })
  );
}

/** One place a formula sits in a body: its issue path, the expression and the dialect from the same item. */
export type FormulaSite = { readonly path: string; readonly expression: unknown; readonly dialect: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A catalog path split at its last `[]`: the items it walks (`""` for the body itself) and the key in each item. */
function splitFormulaPath(path: string): { items: string; leaf: string } {
  const at = path.lastIndexOf("[].");
  return at === -1 ? { items: "", leaf: path } : { items: path.slice(0, at + 2), leaf: path.slice(at + 3) };
}

/** Every item an items path reaches, each with its issue path (`content.kpis.0`). Own keys only. */
function itemsAt(body: unknown, items: string): Array<{ path: string; item: unknown }> {
  let level: Array<{ path: string; item: unknown }> = [{ path: "", item: body }];
  if (items === "") return level;
  for (const segment of items.split(".")) {
    const many = segment.endsWith("[]");
    const key = many ? segment.slice(0, -2) : segment;
    const next: Array<{ path: string; item: unknown }> = [];
    for (const { path, item } of level) {
      if (!isRecord(item) || !Object.prototype.hasOwnProperty.call(item, key)) continue;
      const value = item[key];
      const at = path === "" ? key : `${path}.${key}`;
      if (!many) next.push({ path: at, item: value });
      else if (Array.isArray(value)) value.forEach((element, index) => next.push({ path: `${at}.${index}`, item: element }));
    }
    level = next;
  }
  return level;
}

/**
 * `F3.85` PR 11a — every place a catalog formula sits in a body, with the
 * dialect beside it. A formula in an array (`points[].formula`) has one site
 * per item; its dialect must be in the same item, or the catalog is wrong.
 */
export function formulaSitesOf(body: unknown, formula: CatalogFormula): FormulaSite[] {
  const field = splitFormulaPath(formula.field);
  const dialect = splitFormulaPath(formula.dialectField);
  if (field.items !== dialect.items) {
    throw new Error(`F3.85: ${formula.field} and ${formula.dialectField} are not in the same item`);
  }
  return itemsAt(body, field.items).flatMap(({ path, item }) =>
    isRecord(item) && Object.prototype.hasOwnProperty.call(item, field.leaf)
      ? [{ path: path === "" ? field.leaf : `${path}.${field.leaf}`, expression: item[field.leaf], dialect: item[dialect.leaf] }]
      : [],
  );
}

/**
 * The point keys a formula may name, from the body: every string at
 * `refsField` (`points[].pointKey`). `null` when the formula names no refs
 * path or the body does not carry it — the target's point keys apply then.
 */
export function formulaRefsOf(body: unknown, formula: CatalogFormula): string[] | null {
  if (formula.refsField === undefined) return null;
  const root = formula.refsField.split(/[.[]/)[0] as string;
  if (!isRecord(body) || !Object.prototype.hasOwnProperty.call(body, root)) return null;
  const refs = splitFormulaPath(formula.refsField);
  const names: string[] = [];
  for (const { item } of itemsAt(body, refs.items)) {
    const value = isRecord(item) ? item[refs.leaf] : undefined;
    for (const name of Array.isArray(value) ? value : [value]) if (typeof name === "string") names.push(name);
  }
  return names;
}
