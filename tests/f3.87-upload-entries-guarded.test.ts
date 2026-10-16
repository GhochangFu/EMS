import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** `@bms/shared/copilot` through `createRequire` (it reads `packages/shared/dist`; rebuild it after a catalog edit). */
const require_ = createRequire(import.meta.url);
const { COPILOT_CATALOG } = require_("@bms/shared/copilot") as {
  COPILOT_CATALOG: readonly { id: string; method: string; path: string; upload?: unknown }[];
};

/**
 * `F3.87` PR 6b (ADR 0099 Amendment 3 A3, plan §8.3 D12) — every catalog entry
 * with `upload` is served by a handler that carries the multipart Confirm's
 * route stage. The global `CopilotChangeInterceptor` admits a multipart
 * Confirm only for a handler marked `@CopilotUploadRoute()`, and it defers
 * the body-hash compare to `CopilotUploadChangeInterceptor`, which must run
 * **after** multer (`FileInterceptor(`) has parsed the fields and the file —
 * so a marked handler without the second stage, or with it before multer,
 * would apply a change whose bytes nobody compared.
 *
 * The walk reads every `*.controller.ts` under `apps/api/src`, non-comment
 * lines only; a handler is its route decorator, the decorators above it, and
 * every line down to its `async` method line. Exactly one handler must serve
 * each upload entry's method and path.
 *
 * Assertions inline (§4.6 carves out `tests/`).
 */

const API_SRC = "apps/api/src";
const COMMENT = /^\s*(\/\/|\*|\/\*)/;
const CONTROLLER = /^@Controller\(\s*"([^"]*)"\s*\)/;
const ROUTE = /^\s*@(Get|Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?\s*\)/;
/** A handler's method line; every write handler under `apps/api/src` is `async`. */
const METHOD_LINE = /^\s*(?:public\s+)?async\s+\w+\s*\(/;

type Handler = { file: string; method: string; path: string; source: string };

/** Every `*.controller.ts` under `apps/api/src`, as repo-relative paths (a manual walk). */
function controllers(dir = API_SRC): string[] {
  return readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((dirent) => {
    const rel = `${dir}/${dirent.name}`;
    if (dirent.isDirectory()) return controllers(rel);
    return dirent.name.endsWith(".controller.ts") ? [rel] : [];
  });
}

/** The handlers of one controller source: method, full path, and the decorators and lines down to the method. */
export function handlersOf(file: string, source: string): Handler[] {
  const lines = source.split(/\r?\n/).map((line) => (COMMENT.test(line) ? "" : line));
  let prefix: string | undefined;
  const out: Handler[] = [];
  lines.forEach((line, index) => {
    const controller = CONTROLLER.exec(line);
    if (controller) {
      prefix = controller[1];
      return;
    }
    const route = ROUTE.exec(line);
    if (!route || prefix === undefined) return;
    let start = index;
    // Decorators above the route: up to a blank line, a comment (blanked) or a line that ends a statement or a block.
    while (start > 0 && /\S/.test(lines[start - 1] as string) && !/[;{}]\s*$/.test(lines[start - 1] as string)) start--;
    let end = index + 1;
    while (end < lines.length && !METHOD_LINE.test(lines[end] as string) && !ROUTE.test(lines[end] as string)) end++;
    const sub = route[2] ?? "";
    out.push({
      file,
      method: (route[1] as string).toUpperCase(),
      path: `/${prefix}${sub ? `/${sub}` : ""}`,
      source: lines.slice(start, end + 1).join("\n"),
    });
  });
  return out;
}

/** What is wrong with an upload handler's guard; empty when the two stages are in place, in order. */
export function uploadGuardProblems(handler: Pick<Handler, "source">): string[] {
  const problems: string[] = [];
  if (!/@CopilotUploadRoute\(\s*\)/.test(handler.source)) problems.push("no @CopilotUploadRoute()");
  const multer = handler.source.indexOf("FileInterceptor(");
  const stage = handler.source.search(/\bCopilotUploadChangeInterceptor\b/);
  if (multer === -1) problems.push("no FileInterceptor(");
  if (stage === -1) problems.push("no CopilotUploadChangeInterceptor");
  if (multer !== -1 && stage !== -1 && stage < multer) problems.push("CopilotUploadChangeInterceptor before FileInterceptor(");
  return problems;
}

const HANDLERS = controllers().flatMap((file) => handlersOf(file, read(file)));
const UPLOAD_ENTRIES = COPILOT_CATALOG.filter((entry) => entry.upload !== undefined);

/** The handlers that serve one catalog route (`:param` names may differ, so each segment is compared by shape). */
function servingHandlers(entry: { method: string; path: string }): Handler[] {
  const shape = (path: string) => path.replace(/:[A-Za-z]\w*/g, ":");
  return HANDLERS.filter((handler) => handler.method === entry.method && shape(handler.path) === shape(entry.path));
}

/** A handler with both stages, in order — the shape `mimic-symbol-libraries.controller.ts` follows. */
const GUARDED_FIXTURE = [
  '@Controller("things")',
  "export class ThingsController {",
  '  @Post(":id/files")',
  "  @CopilotUploadRoute()",
  "  @UseInterceptors(",
  '    FileInterceptor("file", { limits: { fileSize: 1, files: 1 } }),',
  "    CopilotUploadChangeInterceptor,",
  "  )",
  "  async upload(@Param(\"id\") id: string) {}",
  "}",
].join("\n");

describe("F3.87 PR 6b — every upload entry's handler carries the multipart Confirm's route stage (plan §8.3)", () => {
  it("positive control: the catalog has the mimicSymbol.upload entry and its one handler is guarded", () => {
    expect(UPLOAD_ENTRIES.map((entry) => entry.id)).toContain("mimicSymbol.upload");
    const served = servingHandlers({ method: "POST", path: "/mimic-symbol-libraries/:id/symbols" });
    expect(served.map((handler) => handler.file)).toEqual(["apps/api/src/mimic-symbol-libraries/mimic-symbol-libraries.controller.ts"]);
    expect(uploadGuardProblems(served[0] as Handler)).toEqual([]);
  });

  it("every upload entry is served by exactly one handler, guarded in order", () => {
    for (const entry of UPLOAD_ENTRIES) {
      const served = servingHandlers(entry);
      expect(served.length, `${entry.id}: handlers serving ${entry.method} ${entry.path}`).toBe(1);
      expect(uploadGuardProblems(served[0] as Handler), entry.id).toEqual([]);
    }
  });

  it("the fixture walker reads a guarded handler's decorators (the negative controls' positive half)", () => {
    const [handler] = handlersOf("fixture.controller.ts", GUARDED_FIXTURE);
    expect(handler?.path).toBe("/things/:id/files");
    expect(uploadGuardProblems(handler as Handler)).toEqual([]);
  });

  it("negative control: a handler without the second stage is refused", () => {
    const source = GUARDED_FIXTURE.replace("    CopilotUploadChangeInterceptor,\n", "");
    expect(uploadGuardProblems(handlersOf("fixture.controller.ts", source)[0] as Handler)).toEqual(["no CopilotUploadChangeInterceptor"]);
  });

  it("negative control: the second stage commented out, or before multer, is refused", () => {
    const commented = GUARDED_FIXTURE.replace("    CopilotUploadChangeInterceptor,", "    // CopilotUploadChangeInterceptor,");
    expect(uploadGuardProblems(handlersOf("fixture.controller.ts", commented)[0] as Handler)).toEqual(["no CopilotUploadChangeInterceptor"]);
    const reordered = GUARDED_FIXTURE.replace(
      '    FileInterceptor("file", { limits: { fileSize: 1, files: 1 } }),\n    CopilotUploadChangeInterceptor,',
      '    CopilotUploadChangeInterceptor,\n    FileInterceptor("file", { limits: { fileSize: 1, files: 1 } }),',
    );
    expect(uploadGuardProblems(handlersOf("fixture.controller.ts", reordered)[0] as Handler)).toEqual([
      "CopilotUploadChangeInterceptor before FileInterceptor(",
    ]);
  });

  it("negative control: a handler without the route mark is refused", () => {
    const source = GUARDED_FIXTURE.replace("  @CopilotUploadRoute()\n", "");
    expect(uploadGuardProblems(handlersOf("fixture.controller.ts", source)[0] as Handler)).toEqual(["no @CopilotUploadRoute()"]);
  });
});
