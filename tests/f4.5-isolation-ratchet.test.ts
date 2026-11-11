import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, inject, it } from "vitest";

import { databaseSuites, HARNESS_OWN_TESTS, REPO_ROOT } from "./harness/integration-files";
import { NOT_YET_ISOLATED, NOT_YET_ISOLATED_COUNT } from "./harness/not-yet-isolated";
import {
  applyRunEnv,
  captureRunEnv,
  planForFile,
  RUN_ENV_KEYS,
  runEnvFor,
  type RunContext,
} from "./harness/run-context";
import { resolveRoleUrls } from "./harness/worker-database";

/**
 * `F4.5` (ADR 0124 decision 6, ruling 7) — the migration ratchet and the wiring that makes the
 * harness run at all.
 *
 * The list of database suites still on the shared database can only shrink: its length is pinned
 * to `NOT_YET_ISOLATED_COUNT`, every entry must be a database suite that exists, and the list is
 * sorted so a batch PR's diff is a clean run of deletions. The wiring checks hold the two config
 * edits in place — a harness nobody calls isolates nothing, and nothing else would notice.
 */

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8");

describe("NOT_YET_ISOLATED ratchet", () => {
  const suites = new Set(databaseSuites());

  it("lists only database suites that exist", () => {
    const stray = NOT_YET_ISOLATED.filter((path) => !suites.has(path));
    expect(stray, "listed but not a database suite (deleted or renamed?) — remove it").toEqual([]);
  });

  it("has exactly NOT_YET_ISOLATED_COUNT entries, so adding one fails and a batch lowers the count", () => {
    expect(NOT_YET_ISOLATED.length).toBe(NOT_YET_ISOLATED_COUNT);
  });

  it("is sorted and free of duplicates", () => {
    expect([...NOT_YET_ISOLATED]).toEqual([...new Set(NOT_YET_ISOLATED)].sort());
  });

  it("never lists the harness's own container test, which manages its own containers", () => {
    for (const path of HARNESS_OWN_TESTS) {
      expect(existsSync(join(REPO_ROOT, path)), path).toBe(true);
      expect(NOT_YET_ISOLATED).not.toContain(path);
      expect(suites.has(path)).toBe(false);
    }
  });

  it("finds a database suite by its gate call, not only by its name", () => {
    expect(suites.has("apps/api/src/dashboard-builder/dashboards.service.mimic.test.ts")).toBe(true);
  });
});

/**
 * A suite that names its own database in a connection string would keep connecting there after
 * it moves to its worker's copy, and its isolation would be a fiction. Comments are skipped; the
 * allowance names each file whose URLs are not connections, and goes stale loudly.
 */
const HARD_CODED_URL_ALLOWANCE: Readonly<Record<string, string>> = {
  "apps/api/src/health/database-health.integration.spec.ts":
    "UNREACHABLE_URL points at port 1 on purpose: the probe must fail to connect",
  "apps/api/src/testing/integration-db-gate.spec.ts":
    "synthetic URLs fed to the gate's pure functions; nothing connects",
};

describe("no database suite hard-codes a connection URL", () => {
  const URL_WITH_DATABASE = /postgres(?:ql)?:\/\/[^\s"'`]*@[^\s"'`/]+\/[A-Za-z_]/;

  function offenders(): string[] {
    const found = new Set<string>();
    for (const suite of databaseSuites()) {
      for (const file of [suite, suite.replace(/\.test\.ts$/, ".spec.ts")]) {
        if (!existsSync(join(REPO_ROOT, file))) continue;
        const code = read(file)
          .split("\n")
          .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));
        if (code.some((line) => URL_WITH_DATABASE.test(line))) found.add(file);
      }
    }
    return [...found].sort();
  }

  it("finds none outside the allowance", () => {
    expect(offenders().filter((file) => !(file in HARD_CODED_URL_ALLOWANCE))).toEqual([]);
  });

  it("keeps no stale allowance", () => {
    expect(offenders()).toEqual(Object.keys(HARD_CODED_URL_ALLOWANCE).sort());
  });
});

describe("the harness is wired in", () => {
  it("the global setup reached this worker (not only written in a config)", () => {
    const run = inject("f45Run");
    expect(run, "f45Run was not provided — vitest.global-setup.ts did not run").toBeDefined();
    expect(["untouched", "isolating"]).toContain(run.kind);
  });

  it("the root config runs the global setup", () => {
    expect(read("vitest.config.ts")).toMatch(/globalSetup:\s*\["\.\/vitest\.global-setup\.ts"\]/);
  });

  it("the repo project runs the worker setup", () => {
    expect(read("vitest.config.ts")).toMatch(/setupFiles:\s*\["\.\/vitest\.worker-setup\.ts"\]/);
  });

  it("the api and ingest projects run the worker setup", () => {
    for (const config of ["apps/api/vitest.config.ts", "apps/ingest/vitest.config.ts"]) {
      expect(read(config), config).toMatch(/setupFiles:\s*\["\.\.\/\.\.\/vitest\.worker-setup\.ts"\]/);
    }
  });

  it("CI's test step runs the suites on the harness's containers (BMS_TEST_DB=containers)", () => {
    const ci = read(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("  build-and-migrate:"));
    const step = job.slice(job.indexOf("- name: Run tests"));
    const stepEnd = step.indexOf("\n      - name:", 1);
    const runTests = stepEnd < 0 ? step : step.slice(0, stepEnd);
    expect(runTests).toMatch(/BMS_TEST_DB:\s*containers/);
    expect(runTests).toMatch(/run:\s*pnpm test:coverage/);
  });

  it("CI's docs-only job starts no test database (BMS_TEST_DB=none)", () => {
    const ci = read(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("  docs-only-tests:"), ci.indexOf("  build-and-migrate:"));
    expect(job).toMatch(/BMS_TEST_DB:\s*none/);
  });
});

const ROLES = resolveRoleUrls({
  DATABASE_URL: "postgres://bms_owner:bms_owner_dev@127.0.0.1:6000/postgres",
  DATABASE_URL_SUPERUSER: "postgres://bms_app:pw@127.0.0.1:6000/postgres",
});

const CONTAINER_RUN: RunContext = {
  kind: "isolating",
  server: "own-container",
  superuserUrl: "postgres://bms_app:pw@127.0.0.1:6000/postgres",
  template: "bms_template",
  prefix: "bms",
  roles: ROLES,
  redisUrl: "redis://:pw@127.0.0.1:6001",
  shared: runEnvFor(ROLES, "bms_shared", "redis://:pw@127.0.0.1:6001", 0),
  suites: ["tests/listed.integration.test.ts", "tests/moved.integration.test.ts"],
};

describe("planForFile", () => {
  const listed = new Set(["tests/listed.integration.test.ts"]);
  const suites = new Set(["tests/listed.integration.test.ts", "tests/moved.integration.test.ts"]);

  it("does nothing when the run has no database context", () => {
    expect(planForFile({ kind: "untouched" }, "tests/x.test.ts", listed, suites, "1", false)).toEqual({ action: "none" });
  });

  it("gives a listed file the shared database", () => {
    const plan = planForFile(CONTAINER_RUN, "tests/listed.integration.test.ts", listed, suites, "1", false);
    expect(plan.action).toBe("apply");
    expect(plan.action === "apply" && new URL(plan.env.DATABASE_URL as string).pathname).toBe("/bms_shared");
  });

  it("gives any other file its worker's own copy, created once per worker", () => {
    const first = planForFile(CONTAINER_RUN, "tests/moved.integration.test.ts", listed, suites, "2", false);
    expect(first.action).toBe("copy-then-apply");
    expect(first.action === "copy-then-apply" && first.database).toBe("bms_w2");
    const second = planForFile(CONTAINER_RUN, "tests/moved.integration.test.ts", listed, suites, "2", true);
    expect(second.action).toBe("apply");
  });

  it("puts a worker on its own Redis index and the shared files on index 0", () => {
    const plan = planForFile(CONTAINER_RUN, "tests/moved.integration.test.ts", listed, suites, "3", true);
    expect(plan.action === "apply" && plan.env.REDIS_URL).toBe("redis://:pw@127.0.0.1:6001/3");
    expect(CONTAINER_RUN.kind === "isolating" && CONTAINER_RUN.shared.REDIS_URL).toBe("redis://:pw@127.0.0.1:6001/0");
  });

  it("leaves a file that is not a database suite alone, so a unit file never waits on Postgres", () => {
    expect(planForFile(CONTAINER_RUN, "apps/api/src/x/unit.test.ts", listed, suites, "1", false)).toEqual({
      action: "none",
    });
  });

  it("names an external run's copy with the run prefix", () => {
    const external: RunContext = { ...CONTAINER_RUN, server: "external", prefix: "bms_tab12cd34" } as RunContext;
    const plan = planForFile(external, "tests/moved.integration.test.ts", listed, suites, "1", false);
    expect(plan.action === "copy-then-apply" && plan.database).toBe("bms_tab12cd34_w1");
  });
});

describe("applyRunEnv", () => {
  it("writes all six variables, so a listed file never inherits an isolated file's database", () => {
    const env: NodeJS.ProcessEnv = {};
    const isolated = planForFile(
      CONTAINER_RUN,
      "tests/moved.integration.test.ts",
      new Set(),
      new Set(["tests/moved.integration.test.ts"]),
      "1",
      true,
    );
    if (isolated.action !== "apply") throw new Error("expected apply");
    applyRunEnv(env, isolated.env);
    applyRunEnv(env, (CONTAINER_RUN as Extract<RunContext, { kind: "isolating" }>).shared);
    for (const key of RUN_ENV_KEYS) {
      expect(env[key], key).not.toContain("bms_w1");
    }
  });

  it("deletes a variable that was unset when the run started", () => {
    const original = captureRunEnv({ DATABASE_URL: "postgres://a@b/c" });
    const env: NodeJS.ProcessEnv = { REDIS_URL: "redis://x/1", DATABASE_URL_FLEET: "postgres://f@b/w1" };
    applyRunEnv(env, original);
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.DATABASE_URL_FLEET).toBeUndefined();
    expect(env.DATABASE_URL).toBe("postgres://a@b/c");
  });
});
