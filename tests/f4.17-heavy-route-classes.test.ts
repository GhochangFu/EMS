import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.17` / ADR 0125 decision 5, plan U6 — the routes that must sit in the
 * `heavy` Stage 2 class (12 per minute per identity, not `read`'s 600 or
 * `write`'s 120).
 *
 * Two rules:
 * 1. **Every handler that takes an upload** (a multer `File(s)Interceptor`,
 *    `FileFieldsInterceptor` or `AnyFilesInterceptor` in its decorators)
 *    carries `@RateLimitClassOf("heavy")`. A new upload route added later
 *    fails here instead of starting in `write`.
 * 2. **The named routes** ADR decision 5 lists — the stock catalogs, every
 *    report and history export, `POST /rules/evaluate`, onboarding discovery
 *    and the copilot turn — carry it too.
 *
 * Handlers are read from comment-stripped source as "the decorator lines
 * directly above one method signature", so a decorator on a neighbouring
 * handler cannot satisfy another's claim; the self-tests below prove both
 * directions on fixtures.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const apiSrc = join(repoRoot, "apps/api/src");
const HEAVY = /@RateLimitClassOf\(\s*["']heavy["']\s*\)/;
const UPLOAD = /\b(?:FileInterceptor|FilesInterceptor|FileFieldsInterceptor|AnyFilesInterceptor)\s*\(/;

type Handler = { name: string; decorators: string };

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Each method in a controller class with the decorator block directly above it. */
export function handlersOf(src: string): Handler[] {
  const out: Handler[] = [];
  let block: string[] | null = null;
  for (const line of stripComments(src).split("\n")) {
    if (block === null) {
      if (/^ {2}@/.test(line)) block = [line];
      continue;
    }
    const signature = /^ {2}(?:public |private |protected )?(?:async )?([A-Za-z_]\w*)\s*\(/.exec(line);
    if (signature && !line.trimStart().startsWith("@")) {
      out.push({ name: signature[1], decorators: block.join("\n") });
      block = null;
      continue;
    }
    block.push(line);
  }
  return out;
}

function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllers(path);
    return name.endsWith(".controller.ts") ? [path] : [];
  });
}

const files = controllers(apiSrc).map((path) => ({
  rel: relative(apiSrc, path).replace(/\\/g, "/"),
  handlers: handlersOf(readFileSync(path, "utf8")),
}));

/** `[controller file, the route decorator as written]` — ADR 0125 decision 5's named heavy routes. */
const NAMED_HEAVY: ReadonlyArray<readonly [string, string]> = [
  ["admin/asset-templates/asset-templates.controller.ts", '@Get("stock")'],
  ["admin/dashboard-templates/dashboard-templates.controller.ts", '@Get("stock")'],
  ["admin/audit/audit.controller.ts", '@Get("export")'],
  ["reports/reports.controller.ts", '@Get("energy/export.csv")'],
  ["reports/reports.controller.ts", '@Get("energy/export.xlsx")'],
  ["reports/reports.controller.ts", '@Get("energy/export.pdf")'],
  ["reports/reports.controller.ts", '@Get("energy/view/export.csv")'],
  ["reports/reports.controller.ts", '@Get("energy/view/export.xlsx")'],
  ["telemetry/telemetry.controller.ts", '@Get("assets/:assetId/history/export.csv")'],
  ["telemetry/telemetry.controller.ts", '@Get("assets/:assetId/history/export.xlsx")'],
  ["trend-points/segment-views.controller.ts", '@Get("sites/:locationId/segment-views/export.csv")'],
  ["trend-points/segment-views.controller.ts", '@Get("sites/:locationId/segment-views/export.xlsx")'],
  ["trend-points/trend-strip.controller.ts", '@Get("sites/:locationId/trend-strip/export.csv")'],
  ["trend-points/trend-strip.controller.ts", '@Get("sites/:locationId/trend-strip/export.xlsx")'],
  ["rules/rules.controller.ts", '@Post("evaluate")'],
  ["admin/onboarding/onboarding.controller.ts", '@Post("sessions/:id/discovery")'],
  ["copilot/copilot-conversations.controller.ts", '@Post(":id/turns")'],
];

describe("F4.17 — heavy-class routes (ADR 0125 decision 5)", () => {
  it("self-test: an upload handler without the decorator is found, and a neighbour's decorator does not count", () => {
    const fixture = [
      "export class Fixture {",
      '  @Post("a")',
      '  @RateLimitClassOf("heavy")',
      "  a(): void {}",
      "",
      '  @Post("b")',
      '  @UseInterceptors(FileInterceptor("file", {',
      "    limits: { fileSize: 1 },",
      "  }))",
      "  async b(",
      "    @UploadedFile() file: unknown,",
      "  ): Promise<void> {}",
      "}",
    ].join("\n");
    const handlers = handlersOf(fixture);
    expect(handlers.map((h) => h.name)).toEqual(["a", "b"]);
    expect(HEAVY.test(handlers[0]?.decorators ?? "")).toBe(true);
    expect(UPLOAD.test(handlers[1]?.decorators ?? "")).toBe(true);
    expect(HEAVY.test(handlers[1]?.decorators ?? "")).toBe(false);
  });

  it("self-test: a commented-out decorator does not count", () => {
    const handlers = handlersOf(
      ['  @Post("a")', '  // @RateLimitClassOf("heavy")', "  a(): void {}"].join("\n"),
    );
    expect(HEAVY.test(handlers[0]?.decorators ?? "")).toBe(false);
  });

  it("positive control: the scan found the upload handlers that exist today", () => {
    const uploads = files.flatMap((f) => f.handlers.filter((h) => UPLOAD.test(h.decorators)));
    // 2 asset-points, 1 onboarding, 2 telemetry-import, 1 asset image,
    // 1 mimic symbol library, 1 copilot turn — measured 2026-11-10.
    expect(uploads.length).toBeGreaterThanOrEqual(8);
  });

  it("every upload handler is in the heavy class", () => {
    const missing = files.flatMap((f) =>
      f.handlers
        .filter((h) => UPLOAD.test(h.decorators) && !HEAVY.test(h.decorators))
        .map((h) => `${f.rel}#${h.name}`),
    );
    expect(missing, `upload handlers without @RateLimitClassOf("heavy"):\n${missing.join("\n")}`).toEqual([]);
  });

  it.each(NAMED_HEAVY)("%s %s is in the heavy class", (rel, route) => {
    const file = files.find((f) => f.rel === rel);
    expect(file, `${rel} not found`).toBeDefined();
    const matching = (file?.handlers ?? []).filter((h) => h.decorators.includes(route));
    expect(matching, `${route} not found exactly once in ${rel}`).toHaveLength(1);
    expect(HEAVY.test(matching[0]?.decorators ?? "")).toBe(true);
  });
});
