import type { ServerKind } from "./template-database";
import { workerDatabaseEnv, workerDatabaseName, type RoleUrls } from "./worker-database";

/**
 * `F4.5` (ADR 0124 decisions 3, 5, 6) — what the global setup hands every worker, and the pure
 * decision of what environment one test file runs under.
 *
 * The global setup decides once per run and `provide`s a `RunContext`. Before each test file,
 * `vitest.worker-setup.ts` asks `planForFile` and applies the answer to `process.env`.
 *
 * **Only database suites are touched.** A unit test file gets no plan and keeps the environment
 * the run started with, exactly as before F4.5 — so a unit file never waits on Postgres.
 *
 * **Every plan writes all six variables.** Under the default `forks` pool with `isolate: true`
 * each file runs in a fresh process (measured by the PR 2 code review), so nothing carries from
 * one file to the next today; writing all six keeps that true under `isolate: false` or the vm
 * pools, where a listed file could otherwise inherit an isolated file's database.
 */

export const RUN_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_SUPERUSER",
  "DATABASE_URL_FLEET",
  "DATABASE_URL_AUTH",
  "DATABASE_URL_TENANT",
  "REDIS_URL",
] as const;

export type RunEnvKey = (typeof RUN_ENV_KEYS)[number];

/** `null` means "unset": the key is deleted from `process.env`. */
export type RunEnv = Record<RunEnvKey, string | null>;

export type RunContext =
  /**
   * Nothing to do: `BMS_TEST_DB=none`, a local run with no database, the shared mode, or an
   * external server with every suite still listed. Every file keeps the environment it started with.
   */
  | { readonly kind: "untouched" }
  | {
      readonly kind: "isolating";
      readonly server: ServerKind;
      /** Superuser URL on the server (any database; `copyDatabase` swaps it). */
      readonly superuserUrl: string;
      readonly template: string;
      /** `bms` on the run's own container; `bms_t<run id>` on an external server. */
      readonly prefix: string;
      /** Role URLs whose database name is replaced per worker. */
      readonly roles: RoleUrls;
      /** Base Redis URL (no index), or `null` when the run has no Redis. */
      readonly redisUrl: string | null;
      /** What a listed file runs under: `bms_shared` on a container, the original env on a server. */
      readonly shared: RunEnv;
      /** Every database suite (`databaseSuites()`); any other file is left alone. */
      readonly suites: readonly string[];
    };

export type FilePlan =
  | { readonly action: "none" }
  | { readonly action: "apply"; readonly env: RunEnv }
  | { readonly action: "copy-then-apply"; readonly database: string; readonly env: RunEnv };

/** The `RunEnv` of a worker database, with Redis index `index` (or no Redis). */
export function runEnvFor(roles: RoleUrls, database: string, redisUrl: string | null, index: number): RunEnv {
  const env = workerDatabaseEnv(roles, database, redisUrl ?? "redis://unused", index);
  return { ...env, REDIS_URL: redisUrl === null ? null : (env.REDIS_URL as string) } as RunEnv;
}

/**
 * The plan for one test file. `path` is repo-relative; `listed` is `NOT_YET_ISOLATED`;
 * `suites` is the run's database suites; `createdHere` says this worker process already made
 * its copy (then no second `CREATE`).
 */
export function planForFile(
  run: RunContext,
  path: string,
  listed: ReadonlySet<string>,
  suites: ReadonlySet<string>,
  poolId: string | undefined,
  createdHere: boolean,
): FilePlan {
  if (run.kind === "untouched" || !suites.has(path)) {
    return { action: "none" };
  }
  if (listed.has(path)) {
    return { action: "apply", env: run.shared };
  }
  const database = workerDatabaseName(poolId, run.prefix);
  const env = runEnvFor(run.roles, database, run.redisUrl, Number(poolId));
  return createdHere ? { action: "apply", env } : { action: "copy-then-apply", database, env };
}

/** Writes a `RunEnv` into an environment object; `null` deletes the key. */
export function applyRunEnv(target: NodeJS.ProcessEnv, env: RunEnv): void {
  for (const key of RUN_ENV_KEYS) {
    const value = env[key];
    if (value === null) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
}

/** The six variables as they are now, for restoring a listed file on an external server. */
export function captureRunEnv(source: NodeJS.ProcessEnv): RunEnv {
  const env = {} as Record<RunEnvKey, string | null>;
  for (const key of RUN_ENV_KEYS) {
    env[key] = source[key] ?? null;
  }
  return env;
}

declare module "vitest" {
  export interface ProvidedContext {
    /** `F4.5`: the run's database context, from `vitest.global-setup.ts`. */
    f45Run: RunContext;
  }
}
