import { relative, sep } from "node:path";

import { expect, inject } from "vitest";

import { REPO_ROOT } from "./tests/harness/integration-files";
import { NOT_YET_ISOLATED } from "./tests/harness/not-yet-isolated";
import { applyRunEnv, planForFile } from "./tests/harness/run-context";
import { copyDatabase } from "./tests/harness/template-database";

/**
 * `F4.5` (ADR 0124 decisions 3, 6) — runs in the worker before each test file of the `api`,
 * `ingest` and `repo` projects, so the database variables are set before the file's own module
 * code reads them (185 integration files read `process.env.DATABASE_URL` at import).
 *
 * A database suite on `NOT_YET_ISOLATED` gets the run's shared database; any other database suite
 * gets its worker's own copy (`CREATE DATABASE … TEMPLATE`, answered `42P04` once it exists). A
 * unit test file is left alone. With no context (`none`, skip, shared, or an external server with
 * every suite listed) it does nothing.
 */

const LISTED = new Set(NOT_YET_ISOLATED);
const CREATED_MARKER = "F45_WORKER_DATABASE_CREATED";

const run = inject("f45Run");
const testPath = expect.getState().testPath;

if (run && run.kind === "isolating") {
  if (!testPath) {
    // Without the path no file can be told apart, and every listed suite would silently lose
    // its database and skip. Fail loudly instead (PR 2 code review, finding 4).
    throw new Error("F4.5: the worker setup ran without a test path; cannot choose a database.");
  }
  const path = relative(REPO_ROOT, testPath).split(sep).join("/");
  const plan = planForFile(
    run,
    path,
    LISTED,
    new Set(run.suites),
    process.env.VITEST_POOL_ID,
    process.env[CREATED_MARKER] === "1",
  );
  if (plan.action === "copy-then-apply") {
    await copyDatabase(run.superuserUrl, run.template, plan.database, run.server);
    process.env[CREATED_MARKER] = "1";
  }
  if (plan.action !== "none") {
    applyRunEnv(process.env, plan.env);
  }
}
