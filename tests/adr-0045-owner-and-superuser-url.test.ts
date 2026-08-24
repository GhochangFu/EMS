import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
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

/**
 * ADR 0045 (`E7.1a`) — the provisioning superuser stays out of the API, and
 * every migration authored after `0041` hands the role back.
 *
 * Kept separate from `tests/repo-invariants.test.ts` for the reason that file
 * records at its own top: it sits at AGENTS.md §4.5's 1000-line cap.
 * `tests/adr-0043-database-url-guard.test.ts` is the model for this one, and
 * that guard **cannot** cover the first assertion here — its `\b` boundaries
 * deliberately do not match inside `DATABASE_URL_*`, which is what keeps it
 * scoped to the bare name.
 */

describe("ADR 0045 — DATABASE_URL_SUPERUSER never reaches the API", () => {
  /**
   * `bms_app` is a superuser, and a superuser bypasses every row-level security
   * policy regardless of `FORCE`. If this connection string reaches the API
   * image, `E7.1a` is undone and nothing fails — every request simply sees
   * every tenant's rows. That is the same defect this repo already shipped once
   * on the `F4.16` branch, recorded in `adr-0043-database-url-guard.test.ts`.
   */
  it("appears in docker-compose.yml only in the migrate service", () => {
    const compose = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
    const services = compose.split(/\n {2}(?=[a-z][a-z0-9-]*:)/);
    const carrying = services
      .filter((block) => block.includes("DATABASE_URL_SUPERUSER"))
      .map((block) => block.trimStart().split(":")[0]);
    expect(carrying).toEqual(["migrate"]);
  });

  /**
   * One file may name it: the integration-test gate, which hands the string to
   * the single suite that needs `SET LOCAL ROLE` (`role-grants`). The exemption
   * is by exact path rather than by a `testing/` glob, so a second one cannot
   * appear without this list changing and a reviewer seeing it.
   */
  const SUPERUSER_URL_EXEMPT = "apps/api/src/testing/integration-db-gate.ts";

  it("is named by no file under apps/api/src except the integration-test gate", () => {
    const offenders = walk(join(repoRoot, "apps", "api", "src"))
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .filter((f) => readFileSync(f, "utf8").includes("DATABASE_URL_SUPERUSER"))
      .map((f) => relative(repoRoot, f).split(sep).join("/"));
    expect(offenders).toEqual([SUPERUSER_URL_EXEMPT]);
  });

  /**
   * What keeps the exemption above honest. The gate is a test helper, so nothing
   * that ships may reach it — if a runtime module imported it, the exemption
   * would have quietly become a route for the superuser string into the running
   * API, which is the exact thing the first assertion exists to prevent.
   */
  it("nothing outside a test file imports the integration-test gate", () => {
    const importers = walk(join(repoRoot, "apps", "api", "src"))
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
      .filter((f) => relative(repoRoot, f).split(sep).join("/") !== SUPERUSER_URL_EXEMPT)
      .filter((f) => /from\s+["'][^"']*integration-db-gate["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(repoRoot, f).split(sep).join("/"));
    expect(importers).toEqual([]);
  });
});

describe("ADR 0045 decision 6 — a migration that takes the owner role gives it back", () => {
  /**
   * ADR 0045 Amendment 1 put the `SET ROLE bms_owner` inside each migration
   * file rather than on the migrator's connection, so that drizzle's own
   * preamble and journal write stay as `bms_app` and need no new grant.
   *
   * That choice depends on `RESET ROLE`. A forgotten one leaks past `COMMIT`
   * into the session — measured, not assumed — so the migrator's journal
   * `INSERT` and every later migration in the same run would execute as
   * `bms_owner`, which holds no grant on the `drizzle` schema. Reviewer
   * attention is not an adequate gate for that, which is why it is here.
   */
  it("every migration after 0041 that issues SET ROLE also issues RESET ROLE", () => {
    const dir = join(repoRoot, "packages", "db", "drizzle");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f >= "0041")
      .filter((f) => {
        // Strip `--` comments so this file's own prose in a migration header
        // cannot satisfy or trip the check.
        const sql = readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, "");
        return /\bSET\s+ROLE\b/i.test(sql) && !/\bRESET\s+ROLE\b/i.test(sql);
      });
    expect(offenders).toEqual([]);
  });

  /**
   * ADR 0023's continuous aggregates have `relkind = 'v'`, so a generic view
   * loop finds them and then fails with `cannot alter continuous aggregate
   * using ALTER VIEW`. That error only appears on a database that has them —
   * CI does, a reviewer's eye does not.
   */
  it("0041 moves the continuous aggregates with ALTER MATERIALIZED VIEW", () => {
    const sql = readFileSync(
      join(repoRoot, "packages", "db", "drizzle", "0041_bms_owner_and_force_rls.sql"),
      "utf8",
    );
    expect(sql).toMatch(/ALTER MATERIALIZED VIEW/);
    expect(sql).toMatch(/continuous_aggregates/);
  });

  /**
   * `0039` set its default privileges `FOR ROLE bms_app`, and default
   * privileges apply only to objects created by the role they name. Once new
   * objects are created by `bms_owner`, a missing mirror means every table a
   * later migration adds reaches no pool role — invisible until `E7.1b` adds
   * its junction tables, then failing one endpoint at a time.
   */
  it("0041 mirrors all four default-privilege statements for bms_owner", () => {
    const sql = readFileSync(
      join(repoRoot, "packages", "db", "drizzle", "0041_bms_owner_and_force_rls.sql"),
      "utf8",
    ).replace(/--[^\n]*/g, "");
    const mirrors = sql.match(/ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner/g) ?? [];
    expect(mirrors).toHaveLength(4);
    // TABLES and SEQUENCES, in both schemas. The zero sequence count today is
    // not a reason to omit the sequence half.
    expect(sql).toMatch(/FOR ROLE bms_owner IN SCHEMA bms\s+GRANT[^;]*ON TABLES/);
    expect(sql).toMatch(/FOR ROLE bms_owner IN SCHEMA telemetry\s+GRANT[^;]*ON TABLES/);
    expect(sql).toMatch(/FOR ROLE bms_owner IN SCHEMA bms\s+GRANT[^;]*ON SEQUENCES/);
    expect(sql).toMatch(/FOR ROLE bms_owner IN SCHEMA telemetry\s+GRANT[^;]*ON SEQUENCES/);
  });
});
