import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F4.49` — the API request logger printed a live `Authorization: Bearer`
 * token on every authenticated request.
 *
 * This file exists because of a seam, not because the subject needed its own
 * home. `apps/api/src/logger.options.spec.ts` proves the `redact` config
 * censors: it runs the real object through a real pino instance, so a
 * malformed path or a bracketed-key typo fails there. What it cannot prove is
 * that `AppModule` still **hands that object to** `LoggerModule.forRoot` — a
 * Nest module cannot be instantiated under Vitest here (`F4.20`,
 * AGENTS.md §4.6: esbuild emits no `design:paramtypes`, so injected
 * dependencies resolve to `undefined`). Reverting `app.module.ts` to the
 * inline `pinoHttp` literal it used to hold would leave that spec green and
 * put bearer tokens back on every request line — a guard that cannot fire
 * under the condition it guards, which is the §4.4 shape. The static check
 * below is the only thing that closes it.
 *
 * It is a **third** `tests/` file rather than an append: AGENTS.md §3 says the
 * next check belonging to no existing ADR file needs one, because
 * `repo-invariants.test.ts` is at the §4.5 line budget. Per §4.6 the path is
 * therefore named explicitly in the root `typecheck:tests` script — a check CI
 * does not execute is not a gate.
 */
describe("logger redaction (F4.49)", () => {
  it("wires the API request logger through the shared, redacting options", () => {
    const rel = "apps/api/src/app.module.ts";
    // Comments are stripped so a commented-out `forRoot` call cannot satisfy
    // this — the failure mode a source-text check exists to avoid.
    const src = readFileSync(join(repoRoot, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

    expect(
      src,
      `${rel} must configure LoggerModule from the shared pinoHttpOptions. An inline pinoHttp ` +
        "literal here is how F4.49 happened: it had no `redact`, so every authenticated request " +
        "wrote its bearer token to a log that leaves the container. See AGENTS.md §9 rule 6.",
    ).toMatch(/LoggerModule\.forRoot\(\s*\{\s*pinoHttp:\s*pinoHttpOptions\s*,?\s*\}\s*\)/);
  });
});
