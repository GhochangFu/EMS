import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The repository root, found by walking up from `process.cwd()` — **not by
 * assuming a fixed depth.**
 *
 * **This exists because of a real `F3.36` failure, and the failure is the whole
 * argument.** Two spec files under `apps/api` read repository files
 * (`stock-catalog.spec.ts` parses migrations `0051`/`0056`;
 * `dashboard-templates.controller.spec.ts` reads its own controller) and both
 * computed the root as `join(process.cwd(), "..", "..")`. That is correct under
 * `pnpm --filter api exec vitest run`, which sets the working directory to
 * `apps/api` — and wrong under `pnpm test` / `pnpm test:coverage`, the ROOT
 * multi-project runner **that CI actually invokes**, where `process.cwd()` is
 * already the repository root. Both suites passed every targeted run and failed
 * with `ENOENT: … D:\packages\db\drizzle\0056_dashboard_templates.sql` on the
 * only runner that matters.
 *
 * A fixed-depth guess is silent about which runner it assumed. This walks up
 * until it finds the workspace manifest, so it is correct from either.
 *
 * **Why not `import.meta.url`**, which the top-level `tests/` directory uses:
 * `apps/api` compiles with `"module": "commonjs"`, and `tsc` refuses the
 * meta-property outright (`TS1343`). `tests/` gets away with it because
 * `typecheck:tests` typechecks that directory under its own `--module esnext`
 * invocation.
 */
const MARKER = "pnpm-workspace.yaml";

export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `could not find ${MARKER} above ${process.cwd()} — the repository root is what every ` +
      "repository-file read in a spec resolves against, and guessing a fixed depth is what " +
      "F3.36 got wrong.",
  );
}

/** Read a repository file by its path relative to the repository root. */
export function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot(), relativePath), "utf8");
}
