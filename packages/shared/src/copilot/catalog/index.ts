import { DASHBOARD_TEMPLATE_ENTRIES } from "./dashboard-templates";
import { DASHBOARD_ENTRIES } from "./dashboards";
import { KPI_ENTRIES } from "./kpis";
import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.85` PR 8 / ADR 0099 decision 2 — the action catalog: every write route
 * the copilot may propose in release 1. One file per area, so PRs 9, 10 and 11
 * never edit the same file (plan §2).
 *
 * `tests/f3.85-catalog-coverage.test.ts` walks the in-release controllers and
 * requires every write route to be here or in {@link EXCLUDED_ROUTES}, and
 * each of both lists to name a route that exists.
 */
export const COPILOT_CATALOG: readonly CatalogEntry[] = [...DASHBOARD_ENTRIES, ...DASHBOARD_TEMPLATE_ENTRIES, ...KPI_ENTRIES];

const F3_86 = "not a release-1 write; F3.86";
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
  { method: "POST", path: "/copilot/changes/:id/reject", reason: COPILOT_OWN },
  // A temporary password is typed by a person, never proposed.
  { method: "POST", path: "/admin/users/:id/temporary-password", reason: "a credential route" },
  // Every DELETE in the in-release controllers.
  { method: "DELETE", path: "/dashboards/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/admin/dashboard-templates/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/admin/asset-templates/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/admin/calc-parameters/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/admin/assets/:assetId/calc-points/:pointKey", reason: NO_DELETE },
  // The asset-template routes that are not KPI writes.
  { method: "POST", path: "/admin/asset-templates", reason: F3_86 },
  { method: "POST", path: "/admin/asset-templates/:id/archive", reason: F3_86 },
  { method: "POST", path: "/admin/asset-templates/:id/draft", reason: F3_86 },
  { method: "POST", path: "/admin/asset-templates/stock/:code/import", reason: F3_86 },
  { method: "POST", path: "/admin/asset-templates/:id/instantiate", reason: F3_86 },
  { method: "POST", path: "/admin/asset-templates/:id/seeded-rules/reapply", reason: F3_86 },
  { method: "POST", path: "/admin/asset-templates/:id/default-dashboards", reason: F3_86 },
  { method: "POST", path: "/admin/asset-templates/:id/migration-preview", reason: F3_86 },
  { method: "POST", path: "/admin/asset-templates/:id/migrate", reason: F3_86 },
  // PR 11 moves these two to catalog entries (plan §10.1).
  { method: "PATCH", path: "/admin/asset-templates/:id", reason: "PR 11" },
  { method: "POST", path: "/admin/asset-templates/:id/publish", reason: "PR 11" },
];

/** The API's global prefix; a stored change's path starts with it (`copilotPendingChangeDtoSchema`). */
export const COPILOT_API_PREFIX = "/api/v1";

const BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(COPILOT_CATALOG.map((entry) => [entry.id, entry]));

/** The catalog entry with this id, or `undefined`. */
export function catalogEntry(id: string): CatalogEntry | undefined {
  return BY_ID.get(id);
}

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
