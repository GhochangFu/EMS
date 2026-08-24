import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

/**
 * Role provisioning.
 *
 * `F4.16` / ADR 0043 Amendment 1 introduced this as a password-setting script
 * for the three non-owner roles. **ADR 0045 (`E7.1a`) makes it the deployment's
 * one provisioning step**: it creates every role this stack needs, sets the
 * `BYPASSRLS` attribute, and gives each a password from the environment.
 *
 * It is a script, not a migration, for one reason: a migration file is
 * committed and a password is not. The statements are built by PostgreSQL's own
 * `format(%I, %L)` rather than by string concatenation, so a password
 * containing a quote cannot become SQL.
 *
 * **It runs as `bms_app`, the provisioning superuser, via
 * `DATABASE_URL_SUPERUSER` — and it runs *before* `pnpm db:migrate`** (ADR 0045
 * decision 6). Both matter. `ALTER ROLE ... BYPASSRLS` is superuser-only in
 * every PostgreSQL version this project targets, and the migrations that grant
 * privileges to these roles cannot run until the roles exist.
 *
 * Nothing here is schema-scoped, and nothing here may become schema-scoped: on
 * a fresh database `bms` and `telemetry` do not exist yet when this runs.
 * Grants belong in a migration.
 */

/**
 * Ordered, and `bms_owner` is first on purpose. Everything downstream of this
 * script — `db:migrate`, `db:seed`, `apps/sim`, `apps/ingest` and every
 * integration fixture — connects as `bms_owner`, so it is the one role whose
 * absence stops the deployment rather than degrading it.
 *
 * `bms_app` is absent because initdb creates it from `POSTGRES_USER` and it
 * already has a password from the same source.
 */
const ROLE_ENV: ReadonlyArray<readonly [role: string, envVar: string]> = [
  ["bms_owner", "BMS_OWNER_PASSWORD"],
  ["bms_tenant", "BMS_TENANT_PASSWORD"],
  ["bms_fleet", "BMS_FLEET_PASSWORD"],
  ["bms_auth", "BMS_AUTH_PASSWORD"],
];

/**
 * Absorbed from migration `0039` by ADR 0045 decision 6. `0039` keeps its own
 * byte-identical copies — the drizzle journal is keyed by file hash, so the
 * file cannot be edited — and they simply never do anything again: on a fresh
 * deployment the roles already exist by the time `0039` runs, its `DO $$` guard
 * skips the creates, and its `ALTER ROLE` statements re-assert attributes that
 * are already set.
 *
 * Every statement is idempotent and re-runs without error.
 */
export const ROLE_PROVISIONING_SQL: readonly string[] = [
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_owner') THEN
    CREATE ROLE bms_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_tenant') THEN
    CREATE ROLE bms_tenant NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_fleet') THEN
    CREATE ROLE bms_fleet NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_auth') THEN
    CREATE ROLE bms_auth NOLOGIN;
  END IF;
END
$$`,
  // ADR 0043 decision 12: the fleet bypass is a role attribute, not a policy
  // exemption, and `FORCE ROW LEVEL SECURITY` does not restrain it.
  "ALTER ROLE bms_fleet BYPASSRLS",
  // `bms_owner` is stated explicitly rather than left to the default. It is the
  // role `FORCE ROW LEVEL SECURITY` exists to constrain, so a `BYPASSRLS` on it
  // would make the whole of `E7.1a` a no-op with every test still passing.
  "ALTER ROLE bms_owner NOBYPASSRLS",
  "ALTER ROLE bms_tenant NOBYPASSRLS",
  "ALTER ROLE bms_auth NOBYPASSRLS",
];

/**
 * ADR 0045 decision 3. There is deliberately no fallback to `DATABASE_URL`:
 * after this ADR that variable names `bms_owner`, which can execute neither
 * `CREATE ROLE` nor `ALTER ROLE ... BYPASSRLS`. Failing here is loud; falling
 * back would fail later, further from the cause.
 */
export function resolveProvisioningUrl(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL_SUPERUSER;
  if (!url) {
    throw new Error(
      "DATABASE_URL_SUPERUSER is required to provision roles. It carries the " +
        "`bms_app` connection (ADR 0045 decision 3); `DATABASE_URL` names " +
        "`bms_owner`, which cannot create a role or set BYPASSRLS.",
    );
  }
  return url;
}

export function buildRolePasswordStatements(
  env: Record<string, string | undefined>,
): Array<{ role: string; password: string }> {
  const missing = ROLE_ENV.filter(([, envVar]) => !env[envVar]).map(([, envVar]) => envVar);
  if (missing.length > 0) {
    throw new Error(
      `Role passwords are required but not set: ${missing.join(", ")}. ` +
        "Set them in the environment; they are deliberately absent from every committed file.",
    );
  }
  return ROLE_ENV.map(([role, envVar]) => ({ role, password: env[envVar] as string }));
}

async function main(): Promise<void> {
  const pkgRoot = process.cwd();
  loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
  loadEnv({ path: resolve(pkgRoot, ".env") });

  const databaseUrl = resolveProvisioningUrl(process.env);
  const statements = buildRolePasswordStatements(process.env);

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    for (const sql of ROLE_PROVISIONING_SQL) {
      await pool.query(sql);
    }
    process.stdout.write(`ADR 0045: ${ROLE_ENV.length + 1} roles provisioned.\n`);

    for (const { role, password } of statements) {
      // Two round trips on purpose. `format` runs server-side with the password
      // as a bind parameter, so the returned text is already correctly quoted;
      // ALTER ROLE itself cannot take a parameter.
      const { rows } = await pool.query<{ stmt: string }>(
        "select format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) as stmt",
        [role, password],
      );
      await pool.query(rows[0].stmt);
      // The password is never logged. The role name is not a secret.
      process.stdout.write(`${role} can now log in.\n`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
