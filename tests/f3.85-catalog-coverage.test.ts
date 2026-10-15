import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

type Route = { method: string; path: string };
type Entry = Route & { id: string; bodyName: string | null };

/** `@bms/shared/copilot` through `createRequire` (it reads `packages/shared/dist`; rebuild it after a catalog edit). */
const require_ = createRequire(import.meta.url);
const { COPILOT_CATALOG, DELETE_ALLOWANCE, EXCLUDED_ROUTES } = require_("@bms/shared/copilot") as {
  COPILOT_CATALOG: readonly Entry[];
  DELETE_ALLOWANCE: readonly Route[];
  EXCLUDED_ROUTES: readonly Route[];
};

/**
 * `F3.85` PR 8 / ADR 0099 decisions 2 and 3 (plan §10.1, §13) — the action
 * catalog against the controllers it covers.
 *
 * - Every write route (`@Post`/`@Put`/`@Patch`/`@Delete`) of a fully covered
 *   controller is a catalog entry or on the exclusion list.
 * - Both lists name routes that exist (a renamed route turns this red rather
 *   than leaving a dead entry).
 * - A `DELETE` entry is one of the two removals on `DELETE_ALLOWANCE`
 *   (`F3.86` PR 2, decision 3 ruling 19); every other walked `DELETE` is
 *   excluded.
 * - Each entry's handler parses the very export the catalog holds
 *   (`bodyName`, imported from `@bms/shared`); a bodyless entry's handler
 *   takes no `@Body()`. `catalog.spec.ts` checks the catalog side by identity.
 *
 * **The walk reads non-comment lines only.** The controllers carry decorator
 * text in docblocks (`dashboard-templates.controller.ts` names
 * `@Post(":id/:verb/:x")`), which a plain text scan reads as a phantom route.
 * The positive control below finds a real route and not that one.
 *
 * Assertions inline (§4.6 carves out `tests/`).
 */
const CONTROLLERS: ReadonlyArray<{ file: string; full: boolean }> = [
  // The five in-release controllers.
  { file: "apps/api/src/dashboard-builder/dashboard-builder.controller.ts", full: true },
  { file: "apps/api/src/admin/dashboard-templates/dashboard-templates.controller.ts", full: true },
  { file: "apps/api/src/admin/asset-templates/asset-templates.controller.ts", full: true },
  { file: "apps/api/src/admin/calc-parameters/calc-parameters.controller.ts", full: true },
  { file: "apps/api/src/admin/asset-points/asset-point-calc-override.controller.ts", full: true },
  // The routes the exclusion list names outside them.
  { file: "apps/api/src/admin/ai-assistant/ai-assistant-settings.controller.ts", full: true },
  { file: "apps/api/src/copilot/copilot-access.controller.ts", full: true },
  { file: "apps/api/src/copilot/copilot-conversations.controller.ts", full: true },
  { file: "apps/api/src/copilot/copilot-changes.controller.ts", full: true },
  // `F3.86` PR 2: the release-2 controllers, every write route an entry or excluded (plan §4.5, §4.6).
  { file: "apps/api/src/admin/locations/locations.controller.ts", full: true },
  { file: "apps/api/src/admin/rtus/rtus.controller.ts", full: true },
  { file: "apps/api/src/admin/assets/assets.controller.ts", full: true },
  { file: "apps/api/src/admin/asset-groups/asset-groups.controller.ts", full: true },
  { file: "apps/api/src/admin/point-keys/point-keys.controller.ts", full: true },
  { file: "apps/api/src/admin/asset-points/asset-points.controller.ts", full: true },
  { file: "apps/api/src/admin/users/users.controller.ts", full: true },
  { file: "apps/api/src/admin/users/user-grants.controller.ts", full: true },
  { file: "apps/api/src/admin/onboarding/onboarding.controller.ts", full: true },
  // `F3.87` PR 2 (ADR 0099 Amendment 3 A1): the release-3 controllers, every route pending until PRs 5 and 6.
  { file: "apps/api/src/mimic-layouts/mimic-layouts.controller.ts", full: true },
  { file: "apps/api/src/mimic-symbol-libraries/mimic-symbol-libraries.controller.ts", full: true },
  { file: "apps/api/src/admin/vocabularies/asset-roles/asset-roles.controller.ts", full: true },
];

const COMMENT = /^\s*(\/\/|\*|\/\*)/;
const CONTROLLER = /^@Controller\(\s*"([^"]*)"\s*\)/;
const WRITE = /^\s*@(Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?\s*\)/;
const ANY_ROUTE = /^\s*@(Get|Post|Put|Patch|Delete)\(/;

type Walked = Route & { file: string; handler: string };

/**
 * The write routes of one controller file, each with its handler's source
 * (decorator to the next route). A file may hold two controllers
 * (`asset-groups.controller.ts`: `admin/asset-groups` and
 * `admin/asset-group-members`), so the prefix is the last `@Controller` above
 * each route, not the file's first (`F3.86` PR 2).
 */
function walk(file: string): Walked[] {
  const lines = read(file).split("\n");
  let prefix: string | undefined;
  const out: Walked[] = [];
  lines.forEach((line, index) => {
    if (COMMENT.test(line)) return;
    const controller = CONTROLLER.exec(line);
    if (controller) {
      prefix = controller[1];
      return;
    }
    const match = WRITE.exec(line);
    if (!match) return;
    let end = index + 1;
    while (end < lines.length && !(ANY_ROUTE.test(lines[end] as string) && !COMMENT.test(lines[end] as string))) end++;
    if (prefix === undefined) throw new Error(`${file}:${index + 1}: a route above any @Controller`);
    const sub = match[2] ?? "";
    out.push({
      file,
      method: (match[1] as string).toUpperCase(),
      path: `/${prefix}${sub ? `/${sub}` : ""}`,
      handler: lines.slice(index, end).filter((l) => !COMMENT.test(l)).join("\n"),
    });
  });
  if (prefix === undefined) throw new Error(`${file}: no @Controller`);
  return out;
}

/** The names a file imports from `@bms/shared` or `@bms/shared/contracts`. */
function sharedImports(file: string): Set<string> {
  const names = new Set<string>();
  for (const match of read(file).matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"@bms\/shared(?:\/contracts)?"/g)) {
    for (const name of (match[1] as string).split(",")) {
      const clean = name.replace(/^\s*type\s+/, "").trim();
      if (clean) names.add(clean);
    }
  }
  return names;
}

/**
 * `F3.85` PR 11a (plan §10.1, §13) — the one entry whose controller parses a
 * local wrapper of the shared body: `updateAssetTemplateBodySchema` is the
 * shared export plus the api-only cycle check (`calc-graph.ts` stays in
 * `apps/api`). The allowance is exact: this controller imports this name from
 * this wrapper, and the wrapper imports the shared export under this alias.
 * `asset-templates.schema-move.spec.ts` proves `_def.schema` is the shared
 * export by identity. `F4.254` PR 2: `assetTemplate.create` is the second
 * row, for the same reason — the create body carries the same cycle check.
 */
const LOCAL_WRAPPERS: ReadonlyArray<{ entryId: string; bodyName: string; controller: string; wrapper: string; alias: string }> = [
  {
    entryId: "assetTemplate.create",
    bodyName: "createAssetTemplateBodySchema",
    controller: "apps/api/src/admin/asset-templates/asset-templates.controller.ts",
    wrapper: "apps/api/src/admin/asset-templates/asset-templates.schema.ts",
    alias: "sharedCreateAssetTemplateBodySchema",
  },
  {
    entryId: "assetTemplate.update",
    bodyName: "updateAssetTemplateBodySchema",
    controller: "apps/api/src/admin/asset-templates/asset-templates.controller.ts",
    wrapper: "apps/api/src/admin/asset-templates/asset-templates.schema.ts",
    alias: "sharedUpdateAssetTemplateBodySchema",
  },
];

/** The names a file imports from one module specifier (`./asset-templates.schema`). */
function importsFrom(file: string, specifier: string): Set<string> {
  const names = new Set<string>();
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  for (const match of read(file).matchAll(new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*"${escaped}"`, "g"))) {
    for (const name of (match[1] as string).split(",")) {
      const clean = name.replace(/^\s*type\s+/, "").trim();
      if (clean) names.add(clean);
    }
  }
  return names;
}

/** Whether an entry's handler reaches the shared body through its declared local wrapper. */
function viaLocalWrapper(entry: Entry, file: string): boolean {
  const wrapper = LOCAL_WRAPPERS.find((w) => w.entryId === entry.id && w.bodyName === entry.bodyName && w.controller === file);
  if (!wrapper) return false;
  return (
    importsFrom(wrapper.controller, "./asset-templates.schema").has(wrapper.bodyName) &&
    sharedImports(wrapper.wrapper).has(`${wrapper.bodyName} as ${wrapper.alias}`) &&
    new RegExp(`export const ${wrapper.bodyName} = ${wrapper.alias}\\b`).test(read(wrapper.wrapper))
  );
}

/**
 * `F3.86` PR 2 (plan §4.6) — entries whose controller passes the body raw and
 * whose service parses it, after its own manager check (`users`, `user-grants`:
 * a non-manager gets 403 before any 400). The allowance is exact: the handler
 * calls this service method, and the service imports the body from
 * `@bms/shared` and parses it inside that method. PR 4 fills the list.
 */
const SERVICE_PARSERS: ReadonlyArray<{
  entryId: string;
  bodyName: string;
  controller: string;
  service: string;
  serviceField: string;
  method: string;
}> = [
  {
    entryId: "user.create",
    bodyName: "createUserBodySchema",
    controller: "apps/api/src/admin/users/users.controller.ts",
    service: "apps/api/src/admin/users/users.service.ts",
    serviceField: "service",
    method: "create",
  },
  {
    entryId: "user.update",
    bodyName: "updateUserBodySchema",
    controller: "apps/api/src/admin/users/users.controller.ts",
    service: "apps/api/src/admin/users/users.service.ts",
    serviceField: "service",
    method: "update",
  },
  {
    entryId: "userGrant.add",
    bodyName: "addUserGrantBodySchema",
    controller: "apps/api/src/admin/users/user-grants.controller.ts",
    service: "apps/api/src/admin/users/user-grants.service.ts",
    serviceField: "service",
    method: "add",
  },
];

/** The source of one method of a class file: from its signature to the next method at the same indent. */
function methodSource(file: string, method: string): string | null {
  const lines = read(file).split("\n");
  const start = lines.findIndex((line) => new RegExp(`^  (?:async )?${method}\\(`).test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^  (?:private |public |protected )?(?:async )?[A-Za-z]+\(/.test(lines[end] as string) && !/^}/.test(lines[end] as string)) end++;
  return lines.slice(start, end).join("\n");
}

/** Whether an entry's handler reaches its body through a declared service parse. */
function viaServiceParser(entry: Entry, route: Walked, parsers: typeof SERVICE_PARSERS = SERVICE_PARSERS): boolean {
  const parser = parsers.find((p) => p.entryId === entry.id && p.bodyName === entry.bodyName && p.controller === route.file);
  if (!parser) return false;
  if (!route.handler.includes(`this.${parser.serviceField}.${parser.method}(`)) return false;
  const body = methodSource(parser.service, parser.method);
  return (
    body !== null &&
    sharedImports(parser.service).has(parser.bodyName) &&
    // `schema.safeParse(` / `.parse(`, or the users service's `parseBody(schema, …)` (a safeParse that throws the 400).
    new RegExp(`\\b${parser.bodyName}\\.(?:safeParse|parse)\\(|\\bparseBody\\(\\s*${parser.bodyName}\\b`).test(body)
  );
}

const key = (route: Route) => `${route.method} ${route.path}`;
const walked = CONTROLLERS.flatMap((controller) => walk(controller.file));
const byKey = new Map(walked.map((route) => [key(route), route]));
const entryKeys = new Set(COPILOT_CATALOG.map(key));
const excludedKeys = new Set(EXCLUDED_ROUTES.map(key));

describe("F3.85 PR 8 — the copilot action catalog covers the write routes (ADR 0099 decisions 2, 3)", () => {
  it("walks real routes and skips decorator text in docblocks (positive control)", () => {
    expect(byKey.has("PATCH /admin/asset-templates/:id")).toBe(true);
    expect(byKey.has("PUT /dashboards/:id/widgets")).toBe(true);
    expect(byKey.has("POST /admin/dashboard-templates/:id/:verb/:x")).toBe(false);
    expect(read(CONTROLLERS[1]?.file as string)).toContain('@Post(":id/:verb/:x")');
  });

  it("takes each route's prefix from the controller above it, in a file with two (positive control)", () => {
    expect(byKey.has("DELETE /admin/asset-group-members/:id")).toBe(true);
    expect(byKey.has("PATCH /admin/asset-group-members/:id")).toBe(true);
    expect(byKey.has("DELETE /admin/asset-groups/:id")).toBe(false);
    expect(byKey.has("POST /admin/asset-groups/:id/members")).toBe(true);
  });

  it("puts every write route of a covered controller in the catalog or on the exclusion list", () => {
    const full = new Set(CONTROLLERS.filter((c) => c.full).map((c) => c.file));
    const missing = walked
      .filter((route) => full.has(route.file))
      .map(key)
      .filter((k) => !entryKeys.has(k) && !excludedKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("names only routes that exist, in both lists", () => {
    expect([...entryKeys].filter((k) => !byKey.has(k))).toEqual([]);
    expect([...excludedKeys].filter((k) => !byKey.has(k))).toEqual([]);
  });

  it("allows a DELETE entry only on the allowance, and excludes every other DELETE walked", () => {
    const allowed = new Set(DELETE_ALLOWANCE.map(key));
    expect([...allowed].sort()).toEqual(["DELETE /admin/asset-group-members/:id", "DELETE /admin/users/:id/grants/:kind/:grantId"]);
    // The allowance names routes that exist.
    for (const k of allowed) expect(byKey.has(k), k).toBe(true);
    const deleteEntries = COPILOT_CATALOG.filter((entry) => entry.method === "DELETE").map(key);
    for (const k of deleteEntries) expect(allowed.has(k), k).toBe(true);
    const deletes = walked.filter((route) => route.method === "DELETE").map(key);
    expect(deletes.length).toBeGreaterThan(5);
    for (const k of deletes) expect(entryKeys.has(k) || excludedKeys.has(k), k).toBe(true);
    for (const k of deletes.filter((d) => !allowed.has(d))) expect(entryKeys.has(k), k).toBe(false);
  });

  it("parses each entry's body with the shared export the catalog holds", () => {
    for (const entry of COPILOT_CATALOG) {
      const route = byKey.get(key(entry));
      if (!route) throw new Error(`${entry.id}: no route`);
      if (entry.bodyName === null) {
        expect(route.handler, entry.id).not.toMatch(/@Body\(/);
      } else if (viaServiceParser(entry, route)) {
        // The controller passes the body raw and its service parses the shared export (`SERVICE_PARSERS`).
        expect(route.handler, entry.id).toMatch(/@Body\(\)/);
      } else {
        expect(route.handler, entry.id).toMatch(new RegExp(`\\b${entry.bodyName}\\b`));
        const shared = sharedImports(route.file).has(entry.bodyName) || viaLocalWrapper(entry, route.file);
        expect(shared, `${entry.id}: ${entry.bodyName} from @bms/shared`).toBe(true);
      }
    }
  });

  it("matches the local-wrapper allowance once per row, and only for its own entries (positive control)", () => {
    const matched = COPILOT_CATALOG.filter((entry) => {
      const route = byKey.get(key(entry));
      return route !== undefined && viaLocalWrapper(entry, route.file);
    }).map((entry) => entry.id);
    expect(matched).toEqual(["assetTemplate.create", "assetTemplate.update"]);
    const other = COPILOT_CATALOG.find((entry) => entry.id === "dashboardTemplate.update") as Entry;
    expect(viaLocalWrapper({ ...other, bodyName: "updateAssetTemplateBodySchema" }, LOCAL_WRAPPERS[0]?.controller as string)).toBe(false);
  });

  it("matches a service-parse allowance only when the handler calls the method and the method parses the body (fixture)", () => {
    const entry = COPILOT_CATALOG.find((e) => e.id === "dashboard.create") as Entry;
    const route = byKey.get(key(entry)) as Walked;
    const row = {
      entryId: entry.id,
      bodyName: entry.bodyName as string,
      controller: route.file,
      service: "apps/api/src/dashboard-builder/dashboards.service.ts",
      serviceField: "dashboards",
      method: "create",
    };
    // The dashboard controller parses the body itself; its service does not, so the row matches nothing.
    expect(viaServiceParser(entry, route, [row])).toBe(false);
    expect(viaServiceParser(entry, route, [])).toBe(false);
    // The method reader is not vacuous: it finds a real method and not a missing one.
    expect(methodSource(row.service, "create")).not.toBeNull();
    expect(methodSource(row.service, "noSuchMethod")).toBeNull();
    // The three real rows each match their own entry (F3.86 PR 4).
    const matched = COPILOT_CATALOG.filter((e) => {
      const r = byKey.get(key(e));
      return r !== undefined && viaServiceParser(e, r);
    }).map((e) => e.id);
    expect(matched.sort()).toEqual(["user.create", "user.update", "userGrant.add"]);
  });
});
