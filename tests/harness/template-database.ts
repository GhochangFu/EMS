import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { pg, type PgClient } from "./pg";
import { assertDatabasePrefix, withDatabase } from "./worker-database";

/**
 * `F4.5` (ADR 0124 decisions 2–3) — prepare one database once, then copy it per worker.
 *
 * The template is built by spawning the **same three CLIs CI runs** (`db:roles`, `db:migrate`,
 * `db:seed`), with the same environment shape (ADR 0045: roles and migrate as the superuser, the
 * seed as `bms_owner` under FORCE RLS). Importing them instead would mean a second way to prepare
 * a database that could drift from the one CI validates.
 *
 * Measured in U1 (2026-11-11, `timescale/timescaledb:2.29.1-pg16`): roles 0.6 s, migrate 1.9 s,
 * seed 4.4 s; the seeded database is 18 MB; `CREATE DATABASE … TEMPLATE` takes ~0.12 s
 * (`WAL_LOG`, the PG16 default) and the copy keeps its hypertable, continuous aggregates, jobs
 * and RLS. Two TimescaleDB background sessions held the template open after
 * `ALLOW_CONNECTIONS false`; they must be terminated before the first copy.
 *
 * **Which server.** Every call names it. On `own-container` — a server this run started — the
 * plain names `bms_template`, `bms_shared`, `bms_w<n>` are allowed. On `external` — a server
 * someone else owns and other runs may share — only run-prefixed names (`bms_t<run id>_…`) are,
 * so a call that forgot its prefix cannot create, copy over or force-drop a developer's own
 * database.
 */

export const TEMPLATE_DATABASE = "bms_template";

export type ServerKind = "own-container" | "external";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The dev role passwords CI sets at job scope (`.github/workflows/ci.yml`). Test-only. */
const DEV_ROLE_PASSWORDS = {
  BMS_OWNER_PASSWORD: "bms_owner_dev",
  BMS_TENANT_PASSWORD: "bms_tenant_dev",
  BMS_FLEET_PASSWORD: "bms_fleet_dev",
  BMS_AUTH_PASSWORD: "bms_auth_dev",
} as const;

/** What CI's "Initialise database schemas" step and `packages/db/docker-init` both run. */
const INIT_SQL =
  "CREATE EXTENSION IF NOT EXISTS timescaledb; " +
  "CREATE SCHEMA IF NOT EXISTS bms AUTHORIZATION bms_app; " +
  "CREATE SCHEMA IF NOT EXISTS telemetry AUTHORIZATION bms_app;";

const PLAIN_NAME = /^bms_(template|shared|w[0-9]{1,2})$/;
const PREFIXED_NAME = /^bms_t[a-z0-9]{6,12}_(template|shared|w[0-9]{1,2})$/;

/**
 * The only names this module will put into SQL. Names are interpolated (`CREATE DATABASE` takes
 * no parameters), so this anchored check over `[a-z0-9_]` is what keeps a quote out.
 */
export function assertDatabaseName(name: string, server: ServerKind): string {
  const allowed = PREFIXED_NAME.test(name) || (server === "own-container" && PLAIN_NAME.test(name));
  if (!allowed) {
    throw new Error(
      `F4.5: refusing to create, copy or drop database ${JSON.stringify(name)} on an ${server} server.`,
    );
  }
  return name;
}

async function onMaintenanceDb<T>(serverUrl: string, work: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: withDatabase(serverUrl, "postgres") });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function runCli(args: readonly string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync("pnpm", args, {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const cause = [result.error?.message, result.signal ? `signal ${result.signal}` : undefined]
      .filter(Boolean)
      .join("; ");
    const tail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split("\n").slice(-20).join("\n");
    throw new Error(
      `F4.5: \`pnpm ${args.join(" ")}\` failed while building the test template` +
        `${cause ? ` (${cause})` : ""}:\n${tail}`,
    );
  }
}

export type BuildTemplateOptions =
  | {
      /** A server this run started: `db:roles` runs first and sets the dev role passwords. */
      readonly server: "own-container";
      readonly database: string;
    }
  | {
      /**
       * A server someone else owns. Roles are cluster-wide and already exist; `db:roles` is not
       * run, because it would reset their passwords. The seed connects with the caller's own
       * `bms_owner` URL (its password is whatever that server uses).
       */
      readonly server: "external";
      readonly database: string;
      readonly ownerUrl: string;
    };

/**
 * Builds the template on the server `superuserUrl` names (any database; the name is replaced),
 * then makes it a template nobody can connect to. Rebuilds from scratch if it already exists.
 */
export async function buildTemplate(superuserUrl: string, options: BuildTemplateOptions): Promise<string> {
  const database = assertDatabaseName(options.database, options.server);

  await onMaintenanceDb(superuserUrl, async (client) => {
    await dropDatabase(client, database, options.server);
    await client.query(`CREATE DATABASE "${database}"`);
  });

  const init = new pg.Client({ connectionString: withDatabase(superuserUrl, database) });
  await init.connect();
  try {
    await init.query(INIT_SQL);
  } finally {
    await init.end();
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["DATABASE_URL_FLEET", "DATABASE_URL_AUTH", "DATABASE_URL_TENANT"]) {
    delete env[key];
  }
  env.DATABASE_URL_SUPERUSER = withDatabase(superuserUrl, database);

  if (options.server === "own-container") {
    // One source for the owner password: the value `db:roles` is about to set is the value the
    // seed connects with.
    Object.assign(env, DEV_ROLE_PASSWORDS);
    const owner = new URL(env.DATABASE_URL_SUPERUSER);
    owner.username = "bms_owner";
    owner.password = DEV_ROLE_PASSWORDS.BMS_OWNER_PASSWORD;
    env.DATABASE_URL = owner.toString();
    runCli(["--filter", "@bms/db", "roles"], env);
  } else {
    env.DATABASE_URL = withDatabase(options.ownerUrl, database);
  }
  runCli(["db:migrate"], env);
  runCli(["db:seed"], env);

  await onMaintenanceDb(superuserUrl, async (client) => {
    await client.query(`ALTER DATABASE "${database}" WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`);
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [database]);
  });
  return database;
}

/** `CREATE DATABASE <name> TEMPLATE <template>`; an existing copy is kept (one per worker). */
export async function copyDatabase(
  superuserUrl: string,
  template: string,
  name: string,
  server: ServerKind,
): Promise<void> {
  assertDatabaseName(template, server);
  assertDatabaseName(name, server);
  await onMaintenanceDb(superuserUrl, async (client) => {
    try {
      await client.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    } catch (err) {
      // 42P04 duplicate_database: this worker's copy already exists — another file in the same
      // worker created it. Anything else is a real failure.
      if ((err as { code?: string }).code !== "42P04") {
        throw err;
      }
    }
  });
}

async function dropDatabase(client: PgClient, name: string, server: ServerKind): Promise<void> {
  assertDatabaseName(name, server);
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (exists.rowCount === 0) {
    return;
  }
  await client.query(`ALTER DATABASE "${name}" WITH IS_TEMPLATE false`);
  await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
}

/**
 * External mode only: drop every database this run created (`<prefix>_*`). Never called with
 * the plain `bms` prefix — a run's own container is simply stopped.
 */
export async function dropRunDatabases(superuserUrl: string, prefix: string): Promise<void> {
  assertDatabasePrefix(prefix);
  if (prefix === "bms") {
    throw new Error("F4.5: refusing to drop databases by the plain bms prefix.");
  }
  await onMaintenanceDb(superuserUrl, async (client) => {
    const rows = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE $1 ESCAPE '\\'",
      [`${prefix.replace(/_/g, "\\_")}\\_%`],
    );
    for (const { datname } of rows.rows) {
      await dropDatabase(client, datname, "external");
    }
  });
}
