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
const { COPILOT_CATALOG, EXCLUDED_ROUTES } = require_("@bms/shared/copilot") as {
  COPILOT_CATALOG: readonly Entry[];
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
 * - No entry is a `DELETE`.
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
  // Only its temporary-password route is excluded; its other writes are `F3.86`.
  { file: "apps/api/src/admin/users/users.controller.ts", full: false },
];

const COMMENT = /^\s*(\/\/|\*|\/\*)/;
const CONTROLLER = /^@Controller\(\s*"([^"]*)"\s*\)/;
const WRITE = /^\s*@(Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?\s*\)/;
const ANY_ROUTE = /^\s*@(Get|Post|Put|Patch|Delete)\(/;

type Walked = Route & { file: string; handler: string };

/** The write routes of one controller, each with its handler's source (decorator to the next route). */
function walk(file: string): Walked[] {
  const lines = read(file).split("\n");
  const prefix = lines.filter((line) => !COMMENT.test(line)).map((line) => CONTROLLER.exec(line)?.[1]).find(Boolean);
  if (prefix === undefined) throw new Error(`${file}: no @Controller`);
  const out: Walked[] = [];
  lines.forEach((line, index) => {
    if (COMMENT.test(line)) return;
    const match = WRITE.exec(line);
    if (!match) return;
    let end = index + 1;
    while (end < lines.length && !(ANY_ROUTE.test(lines[end] as string) && !COMMENT.test(lines[end] as string))) end++;
    const sub = match[2] ?? "";
    out.push({
      file,
      method: (match[1] as string).toUpperCase(),
      path: `/${prefix}${sub ? `/${sub}` : ""}`,
      handler: lines.slice(index, end).filter((l) => !COMMENT.test(l)).join("\n"),
    });
  });
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

  it("holds no DELETE entry, and every DELETE walked is excluded", () => {
    expect(COPILOT_CATALOG.filter((entry) => entry.method === "DELETE")).toEqual([]);
    const deletes = walked.filter((route) => route.method === "DELETE").map(key);
    expect(deletes.length).toBeGreaterThan(5);
    for (const k of deletes) expect(excludedKeys.has(k), k).toBe(true);
  });

  it("parses each entry's body with the shared export the catalog holds", () => {
    for (const entry of COPILOT_CATALOG) {
      const route = byKey.get(key(entry));
      if (!route) throw new Error(`${entry.id}: no route`);
      if (entry.bodyName === null) {
        expect(route.handler, entry.id).not.toMatch(/@Body\(/);
      } else {
        expect(route.handler, entry.id).toMatch(new RegExp(`\\b${entry.bodyName}\\b`));
        expect(sharedImports(route.file).has(entry.bodyName), `${entry.id}: ${entry.bodyName} from @bms/shared`).toBe(true);
      }
    }
  });
});
