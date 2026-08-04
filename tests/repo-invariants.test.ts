import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const searchRoots = ["apps", "packages"];
const skipDirs = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function sourceFiles(): string[] {
  return searchRoots.flatMap((root) => {
    const dir = join(repoRoot, root);
    try {
      return walk(dir);
    } catch {
      return [];
    }
  });
}

/**
 * Repository-wide structural invariants (ADR 0014).
 *
 * These guard the failure mode this repo keeps hitting: an artefact exists and
 * looks authoritative, but nothing executes it. The drizzle journal hook
 * (`.claude/hooks/check-drizzle-journal.mjs`) is the same idea for migrations;
 * this is its counterpart for tests.
 */
describe("repo invariants", () => {
  it("every .spec file has a .test wrapper that runs it", () => {
    const files = sourceFiles();
    const present = new Set(files);

    const orphans = files
      .filter((f) => /\.spec\.(ts|tsx|js|mjs)$/.test(f))
      .filter((f) => !present.has(f.replace(/\.spec\.(ts|tsx|js|mjs)$/, ".test.$1")))
      .map((f) => relative(repoRoot, f).replace(/\\/g, "/"));

    // Assertions live in .spec files, but Vitest only discovers .test files —
    // and it excludes .spec files from coverage too, so an unwrapped spec is
    // invisible to both the runner and the coverage gate. This is the only
    // thing that catches it. If you are reading this because the test failed:
    // add the sibling wrapper, do not delete the spec.
    expect(orphans, `spec files that no .test wrapper runs:\n${orphans.join("\n")}`).toEqual([]);
  });
});
