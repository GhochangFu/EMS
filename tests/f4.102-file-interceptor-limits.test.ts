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
 * The decorator expression a `FileInterceptor(` call sits inside: from its
 * opening parenthesis to the matching close, by depth counting.
 *
 * **The honest limit of this scan.** It is regex-and-brace deep, not a parse.
 * A `limits` object hoisted into a named constant and passed by reference would
 * satisfy it without ever being inspected, and a parenthesis inside a string
 * literal would confuse the depth count. Both are acceptable: the failure this
 * guards is a new upload route written without limits at all, which is what
 * happened to `POST /admin/onboarding/sessions/:id/upload` and stood for the
 * life of three spreadsheet routes.
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
 * review. Five occurrences across three controllers pass this today.
 *
 * This gates that the limit is **declared**. It cannot gate that it is
 * enforced — no Nest module is instantiated anywhere in the suite, so nothing
 * exercises multer — which is why each parser keeps its own byte cap as well.
 */
describe("F4.102 — every file upload route declares a size limit", () => {
  it("gives every FileInterceptor a limits.fileSize", () => {
    const files = controllerFiles(controllerRoot);
    const missing: string[] = [];
    let occurrences = 0;

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (let at = source.indexOf("FileInterceptor("); at >= 0; at = source.indexOf("FileInterceptor(", at + 1)) {
        occurrences += 1;
        const expression = callExpression(source, at);
        if (!/limits\s*:/.test(expression) || !/fileSize\s*:/.test(expression)) {
          missing.push(
            `${relative(repoRoot, file).replace(/\\/g, "/")}: ${expression.replace(/\s+/g, " ").slice(0, 120)}`,
          );
        }
      }
    }

    // The scan must not be able to pass by finding nothing — a broken walk or a
    // moved source root would otherwise read as green.
    expect(files.length, "the controller scan found no controllers at all").toBeGreaterThan(0);
    expect(occurrences, "the scan found no FileInterceptor at all").toBeGreaterThan(0);
    expect(
      missing,
      "FileInterceptor without limits.fileSize (F4.102, owner ruling 4): " + missing.join(" | "),
    ).toEqual([]);
  });
});
