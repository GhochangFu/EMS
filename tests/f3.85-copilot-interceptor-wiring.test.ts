import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5 — the wiring the `X-Copilot-Change`
 * seam depends on, none of which a unit spec can see:
 *
 * - **No global pipe.** The interceptor hashes `req.body`, the object
 *   `@Body()` hands the controller. A global pipe that transformed bodies would
 *   make the hashed object differ from the one the handler writes.
 * - `CopilotModule` registers the interceptor as `APP_INTERCEPTOR` and applies
 *   `CopilotContextMiddleware` to every route — without the middleware the
 *   interceptor fails closed, and without the registration nothing checks the
 *   header at all.
 * - **CORS lets the header through.** `main.ts` sets no `allowedHeaders`, so
 *   the `cors` package reflects `Access-Control-Request-Headers`; a list that
 *   left the header out would block every Confirm from the dev SPA.
 * - **The `./copilot` subpath resolves everywhere**: the manifest's `exports`
 *   and `typesVersions` (Node resolution in the API), and the web's Vite alias
 *   above the bare `@bms/shared` entry. `tsc` stays silent when the alias is
 *   missing; only `vite build` and the web specs fail.
 */

/** A line that is a comment, so prose naming a call is not the call (`tests/adr-0029`). */
const isComment = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line);
const GLOBAL_PIPE = /\buseGlobalPipes\s*\(|\bprovide:\s*APP_PIPE\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".spec.ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("F3.85 — the copilot interceptor's wiring (ADR 0099 decision 4.5)", () => {
  it("the global-pipe pattern matches both registration forms (positive control)", () => {
    expect(GLOBAL_PIPE.test("  app.useGlobalPipes(new ValidationPipe());")).toBe(true);
    expect(GLOBAL_PIPE.test("    { provide: APP_PIPE, useClass: ValidationPipe },")).toBe(true);
    expect(isComment(" * `useGlobalPipes` is not used here")).toBe(true);
  });

  it("registers no global pipe anywhere in the API", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(repoRoot, "apps/api/src"))) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (!isComment(line) && GLOBAL_PIPE.test(line)) {
            offenders.push(`${relative(repoRoot, file).replaceAll("\\", "/")}:${index + 1}`);
          }
        });
    }
    expect(offenders, "a global pipe changes the body the interceptor hashes").toEqual([]);
  });

  it("CopilotModule registers the interceptor globally and the middleware on every route", () => {
    const code = read("apps/api/src/copilot/copilot.module.ts")
      .split(/\r?\n/)
      .filter((line) => !isComment(line))
      .join("\n");
    expect(code).toMatch(/\{\s*provide:\s*APP_INTERCEPTOR,\s*useClass:\s*CopilotChangeInterceptor\s*\}/);
    expect(code).toMatch(/class CopilotModule implements NestModule/);
    expect(code).toMatch(/consumer\.apply\(CopilotContextMiddleware\)\.forRoutes\("\*"\)/);
    expect(read("apps/api/src/app.module.ts")).toMatch(/\bCopilotModule\b/);
  });

  it("CORS lets X-Copilot-Change through", () => {
    const code = read("apps/api/src/main.ts")
      .split(/\r?\n/)
      .filter((line) => !isComment(line))
      .join("\n");
    expect(code).toMatch(/app\.enableCors\(/);
    if (/\ballowedHeaders\b/.test(code)) {
      expect(code, "an allowedHeaders list must name the copilot header").toMatch(/X-Copilot-Change/i);
    }
  });

  it("publishes the ./copilot subpath in the shared manifest", () => {
    const manifest = JSON.parse(read("packages/shared/package.json")) as {
      exports: Record<string, Record<string, string>>;
      typesVersions: Record<string, Record<string, string[]>>;
    };
    expect(manifest.exports["./copilot"]).toEqual({
      types: "./dist/copilot/index.d.ts",
      import: "./dist/copilot/index.js",
      require: "./dist/copilot/index.js",
    });
    expect(manifest.typesVersions["*"]?.copilot).toEqual(["./dist/copilot/index.d.ts"]);
  });

  it("aliases @bms/shared/copilot in the web's Vite config, above the bare entry", () => {
    const vite = read("apps/web/vite.config.ts");
    const subpath = vite.indexOf('find: "@bms/shared/copilot"');
    const bare = vite.indexOf('find: "@bms/shared",');
    expect(subpath, "no @bms/shared/copilot alias").toBeGreaterThanOrEqual(0);
    expect(bare, "no bare @bms/shared alias").toBeGreaterThanOrEqual(0);
    expect(subpath).toBeLessThan(bare);
    expect(vite.slice(subpath, bare)).toContain("packages/shared/src/copilot/index.ts");
  });
});
