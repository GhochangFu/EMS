import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolved from this file's own location, never from `process.cwd()`. A spec
// that reads repo files through `cwd` passes under a filtered run and dies
// under the root `pnpm test`, where the working directory is not the repo root.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const controllerRoot = join(repoRoot, "apps/api/src");
const skipDirs = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) controllerFiles(full, out);
    else if (entry.endsWith(".controller.ts")) out.push(full);
  }
  return out;
}

/**
 * Nest's four multipart interceptors, as a closed list.
 *
 * The scan matched `FileInterceptor(` by `indexOf` when it first shipped, which
 * finds none of the other three — and catching a **new** upload route is the
 * whole purpose of the file. Nothing uses the plural variants today, so this
 * changes no current result; it changes what happens the day one is added.
 */
const UPLOAD_INTERCEPTORS = /\b(File|Files|FileFields|AnyFiles)Interceptor\s*\(/g;

/**
 * The decorator expression an interceptor call sits inside: from its opening
 * parenthesis to the matching close, by depth counting.
 *
 * **The honest limit of this scan.** It is regex-and-brace deep, not a parse.
 * Everything below still passes it unseen:
 *
 * - a `limits` object hoisted into a named constant and passed by reference,
 *   which satisfies the text match without ever being inspected;
 * - a parenthesis inside a string literal, which confuses the depth count;
 * - an interceptor reached under any other name — an alias
 *   (`import { FileInterceptor as Upload }`), a custom `NestInterceptor` that
 *   wraps multer, or a route that reads the raw body itself. The four names
 *   above are a closed list, so a fifth from a future Nest release is invisible
 *   until this constant is updated;
 * - an upload route in a file not named `*.controller.ts`, which the walk never
 *   opens.
 *
 * All of that is acceptable. The failure this guards is a new upload route
 * written without limits at all, which is what happened to
 * `POST /admin/onboarding/sessions/:id/upload` and stood for the life of three
 * spreadsheet routes.
 */
function callExpression(source: string, callIndex: number): string {
  const open = source.indexOf("(", callIndex);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/**
 * `F4.102`, owner ruling 4 — every multipart upload route declares a byte cap.
 *
 * Nest's `FileInterceptor` buffers whatever arrives when it is given no
 * `limits`: multer's `fileSize` defaults to Infinity, and so does `fields`, at
 * 1 MB each. `apps/api/src/admin/asset-points` and
 * `apps/api/src/admin/telemetry-import` carried the limits from F1.9; the
 * onboarding upload did not, and nothing noticed for three routes' worth of
 * review. Five occurrences across three controllers pass this today, all of
 * them the singular `FileInterceptor`; the count is deliberately not pinned, so
 * a legitimate new upload route is a passing case rather than a failing one.
 *
 * This gates that the limit is **declared**. It cannot gate that it is
 * enforced — no Nest module is instantiated anywhere in the suite, so nothing
 * exercises multer — which is why each parser keeps its own byte cap as well.
 */
describe("F4.102 — every file upload route declares a size limit", () => {
  it("gives every upload interceptor a limits.fileSize", () => {
    const files = controllerFiles(controllerRoot);
    const missing: string[] = [];
    let occurrences = 0;

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // One pass with one regex, so a `FilesInterceptor` is neither missed nor
      // counted twice by an overlapping `FileInterceptor` search.
      for (const match of source.matchAll(UPLOAD_INTERCEPTORS)) {
        occurrences += 1;
        const expression = callExpression(source, match.index);
        if (!/limits\s*:/.test(expression) || !/fileSize\s*:/.test(expression)) {
          missing.push(
            `${relative(repoRoot, file).replace(/\\/g, "/")}: ${match[1]}Interceptor${expression.replace(/\s+/g, " ").slice(0, 120)}`,
          );
        }
      }
    }

    // The scan must not be able to pass by finding nothing — a broken walk or a
    // moved source root would otherwise read as green.
    expect(files.length, "the controller scan found no controllers at all").toBeGreaterThan(0);
    expect(occurrences, "the scan found no upload interceptor at all").toBeGreaterThan(0);
    expect(
      missing,
      "an upload interceptor without limits.fileSize (F4.102, owner ruling 4): " + missing.join(" | "),
    ).toEqual([]);
  });
});
