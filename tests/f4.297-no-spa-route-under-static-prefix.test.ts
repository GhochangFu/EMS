import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F4.297` (live 404 found 2026-11-01) — both nginx configs serve `location /assets/` as Vite's
 * hashed build files with `try_files $uri =404` (F4.130), so a SPA route under `/assets/` is a 404
 * on a hard refresh or a shared link. The only `/assets/…` route allowed in `app.tsx` is the
 * documented redirect of the old history path. Comments are stripped before matching.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const ALLOWED_REDIRECT = "/assets/:assetId/history";

function routePaths(source: string): string[] {
  return Array.from(source.matchAll(/path=\{?\s*["'`]([^"'`]*)["'`]/g), (match) => match[1]);
}

function violations(source: string): string[] {
  return routePaths(source).filter((path) => path.startsWith("/assets/") && path !== ALLOWED_REDIRECT);
}

const app = withoutComments(readFileSync(join(repoRoot, "apps/web/src/app.tsx"), "utf8"));

describe("F4.297 — no SPA route under the /assets/ static prefix", () => {
  it("only the documented legacy redirect starts with /assets/", () => {
    expect(violations(app)).toEqual([]);
  });

  it("positive control — the scan sees the history route at /asset-history/:assetId", () => {
    expect(routePaths(app)).toContain("/asset-history/:assetId");
  });

  it("positive control — the legacy redirect route is present", () => {
    expect(routePaths(app)).toContain(ALLOWED_REDIRECT);
  });

  it("positive control — a new route under /assets/ is caught", () => {
    const mutated = app.replace('path="/asset-history/:assetId"', 'path="/assets/:assetId/other"');
    expect(mutated).not.toBe(app);
    expect(violations(mutated)).toEqual(["/assets/:assetId/other"]);
  });
});
