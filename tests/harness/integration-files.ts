import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `F4.5` (ADR 0124 decision 6) — which test files are database suites.
 *
 * A database suite is a file Vitest runs (`*.test.ts`) that is named `*.integration.test.ts`, or
 * that — itself or through its `.spec.ts` sibling — calls one of the two integration gates.
 * The second clause is what catches a database suite without the name (today one:
 * `dashboards.service.mimic.test.ts`). Paths are repo-relative with `/` separators.
 */

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Where Vitest's database-using projects (`api`, `ingest`, `repo`) look for tests. */
const ROOTS = ["apps/api/src", "apps/ingest/src", "tests"] as const;

/**
 * Integration files the harness must not touch: the harness's own container test starts and
 * reads its own containers, whatever the run's mode.
 */
export const HARNESS_OWN_TESTS: readonly string[] = ["tests/f4.5-test-harness.integration.test.ts"];

const GATE_CALL = /\brequireIntegration(Db|Redis)\s*\(/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
}

function callsGate(file: string): boolean {
  if (GATE_CALL.test(readFileSync(file, "utf8"))) return true;
  const spec = file.replace(/\.test\.ts$/, ".spec.ts");
  return existsSync(spec) && GATE_CALL.test(readFileSync(spec, "utf8"));
}

/** Every database suite in the tree, sorted, excluding `HARNESS_OWN_TESTS`. */
export function databaseSuites(repoRoot: string = REPO_ROOT): string[] {
  const files: string[] = [];
  for (const root of ROOTS) {
    const dir = join(repoRoot, root);
    if (existsSync(dir)) walk(dir, files);
  }
  return files
    .filter((file) => file.endsWith(".integration.test.ts") || callsGate(file))
    .map((file) => relative(repoRoot, file).split("\\").join("/"))
    .filter((path) => !HARNESS_OWN_TESTS.includes(path))
    .sort();
}
