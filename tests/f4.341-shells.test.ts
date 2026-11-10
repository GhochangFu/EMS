import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { SHELL_OF_DESIGN } from "../apps/web/src/lib/design";
import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.341` PR 5 (ADR 0118 decision 6) as amended by `F4.346` (ADR 0118 Amendment 3 decision 1,
 * plan S1) — `SHELL_OF_DESIGN` names a shell for every design system of the contract and nothing
 * else, and it is the amended table: `sidebar` for `nexus-soft`, `enterprise-flat`, `swiss-grid`
 * and `bento-ops`, `rail` for `control-room-dark`. The `topbar` shell is gone: no source file under
 * `apps/web/src` names it.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

describe("F4.341 / F4.346 the shell of each design system", () => {
  it("SH5 SHELL_OF_DESIGN is total over the contract", () => {
    expect(Object.keys(SHELL_OF_DESIGN).sort()).toEqual([...DESIGN_SYSTEMS].sort());
  });

  it("S1 SHELL_OF_DESIGN is ADR 0118 Amendment 3's table: two shells", () => {
    expect(SHELL_OF_DESIGN).toEqual({
      "nexus-soft": "sidebar",
      "enterprise-flat": "sidebar",
      "swiss-grid": "sidebar",
      "bento-ops": "sidebar",
      "control-room-dark": "rail",
    });
  });

  it("S1 no topbar shell: the value is in no web source file and its module is deleted", () => {
    const web = join(repoRoot, "apps/web/src");
    const hits = sourceFiles(web).filter((file) => /\btopbar\b|TopbarShell/.test(readFileSync(file, "utf8")));
    expect(hits.map((f) => relative(repoRoot, f))).toEqual([]);
    expect(readdirSync(join(web, "layouts/shells"))).not.toContain("topbar-shell.tsx");
  });
});
