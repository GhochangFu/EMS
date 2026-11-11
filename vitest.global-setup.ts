import { randomBytes } from "node:crypto";

import type { TestProject } from "vitest/node";

import { startRedis, startTimescale, type StartedServer } from "./tests/harness/containers";
import { dockerAnswers } from "./tests/harness/docker";
import { databaseSuites } from "./tests/harness/integration-files";
import { NOT_YET_ISOLATED } from "./tests/harness/not-yet-isolated";
import { captureRunEnv, runEnvFor, type RunContext } from "./tests/harness/run-context";
import {
  buildTemplate,
  copyDatabase,
  dropRunDatabases,
  TEMPLATE_DATABASE,
} from "./tests/harness/template-database";
import { dockerDecides, testInfraMode } from "./tests/harness/test-infra-mode";
import { resolveRoleUrls } from "./tests/harness/worker-database";

/**
 * `F4.5` (ADR 0124) — the run's database, decided once and handed to every worker.
 *
 * Reads `testInfraMode` (decision 5), then:
 * - **containers** — starts one TimescaleDB and one Redis, builds `bms_template` with the CLIs
 *   CI runs, copies `bms_shared` for the files still on `NOT_YET_ISOLATED`, and stops both
 *   containers at teardown;
 * - **external** — on the server `DATABASE_URL` names: if any database suite is no longer
 *   listed, builds a run-prefixed template there for them and drops the run's databases at
 *   teardown; listed files keep the environment they started with;
 * - **none / skip / shared** — touches nothing, so every suite meets its own gate as before;
 * - **refuse** — fails the run, as the suites' own gates do under `CI`.
 *
 * Each worker applies the context in `vitest.worker-setup.ts`.
 */

const SHARED_DATABASE = "bms_shared";

/** The projects that hold database suites; a run selecting none of them needs no database. */
const DATABASE_PROJECTS = new Set(["api", "ingest", "repo"]);


function baseRedisUrl(url: string | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  const parsed = new URL(trimmed);
  parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

async function startContainers(): Promise<[StartedServer, StartedServer]> {
  const [pg, redis] = await Promise.allSettled([startTimescale(), startRedis()]);
  if (pg.status === "fulfilled" && redis.status === "fulfilled") {
    return [pg.value, redis.value];
  }
  await Promise.allSettled(
    [pg, redis].flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value.stop()] : [])),
  );
  throw [pg, redis].find((outcome) => outcome.status === "rejected")?.reason;
}

/**
 * Decides the run's database and `provide`s it as `f45Run`; returns the teardown that stops the
 * containers or drops the run's databases.
 */
export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const untouched: RunContext = { kind: "untouched" };
  // `vitest --project web` and the like hold no database suite: start nothing, probe nothing.
  if (!project.vitest.projects.some((selected) => DATABASE_PROJECTS.has(selected.name))) {
    project.provide("f45Run", untouched);
    return undefined;
  }
  const verdict = testInfraMode(process.env, dockerDecides(process.env) ? await dockerAnswers() : false);

  if (verdict.kind === "refuse") {
    throw new Error(`F4.5: ${verdict.reason}`);
  }
  if (verdict.kind === "skip") {
    process.stderr.write(`\n[F4.5] No test database: ${verdict.reason}\n\n`);
  }
  if (verdict.kind === "skip" || verdict.kind === "none") {
    project.provide("f45Run", untouched);
    return undefined;
  }

  const suites = databaseSuites();

  if (verdict.kind === "external") {
    const listed = new Set(NOT_YET_ISOLATED);
    const anyMoved = suites.some((path) => !listed.has(path));
    if (!verdict.isolate || !anyMoved) {
      project.provide("f45Run", untouched);
      return undefined;
    }
    const roles = resolveRoleUrls(process.env);
    const prefix = `bms_t${randomBytes(4).toString("hex")}`;
    const template = `${prefix}_template`;
    try {
      await buildTemplate(roles.superuser, { server: "external", database: template, ownerUrl: roles.owner });
    } catch (err) {
      await dropRunDatabases(roles.superuser, prefix).catch(() => undefined);
      throw err;
    }
    project.provide("f45Run", {
      kind: "isolating",
      server: "external",
      superuserUrl: roles.superuser,
      template,
      prefix,
      roles,
      redisUrl: baseRedisUrl(process.env.REDIS_URL),
      shared: captureRunEnv(process.env),
      suites,
    });
    return async () => {
      await dropRunDatabases(roles.superuser, prefix);
    };
  }

  const [postgres, redis] = await startContainers();
  const stop = async (): Promise<void> => {
    await Promise.allSettled([postgres.stop(), redis.stop()]);
  };
  try {
    await buildTemplate(postgres.url, { server: "own-container", database: TEMPLATE_DATABASE });
    await copyDatabase(postgres.url, TEMPLATE_DATABASE, SHARED_DATABASE, "own-container");
  } catch (err) {
    await stop();
    throw err;
  }
  const owner = new URL(postgres.url);
  owner.username = "bms_owner";
  owner.password = "bms_owner_dev";
  const roles = resolveRoleUrls({ DATABASE_URL: owner.toString(), DATABASE_URL_SUPERUSER: postgres.url });
  project.provide("f45Run", {
    kind: "isolating",
    server: "own-container",
    superuserUrl: postgres.url,
    template: TEMPLATE_DATABASE,
    prefix: "bms",
    roles,
    redisUrl: redis.url,
    shared: runEnvFor(roles, SHARED_DATABASE, redis.url, 0),
    suites,
  });
  return stop;
}
