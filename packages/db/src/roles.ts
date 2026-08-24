import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

/**
 * `F4.16` / ADR 0043 Amendment 1 — sets `LOGIN` and a password on the three
 * non-owner roles.
 *
 * This is a script, not a migration, for one reason: a migration file is
 * committed and a password is not. Migration `0039` creates the roles NOLOGIN;
 * this gives them a password from the environment, and the statement is built
 * by PostgreSQL's own `format(%I, %L)` rather than by string concatenation, so
 * a password containing a quote cannot become SQL.
 */
const ROLE_ENV: ReadonlyArray<readonly [role: string, envVar: string]> = [
  ["bms_tenant", "BMS_TENANT_PASSWORD"],
  ["bms_fleet", "BMS_FLEET_PASSWORD"],
  ["bms_auth", "BMS_AUTH_PASSWORD"],
];

export function buildRolePasswordStatements(
  env: Record<string, string | undefined>,
): Array<{ role: string; password: string }> {
  const missing = ROLE_ENV.filter(([, envVar]) => !env[envVar]).map(([, envVar]) => envVar);
  if (missing.length > 0) {
    throw new Error(
      `F4.16: role passwords are required but not set: ${missing.join(", ")}. ` +
        "Set them in the environment; they are deliberately absent from every committed file.",
    );
  }
  return ROLE_ENV.map(([role, envVar]) => ({ role, password: env[envVar] as string }));
}

async function main(): Promise<void> {
  const pkgRoot = process.cwd();
  loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
  loadEnv({ path: resolve(pkgRoot, ".env") });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to set role passwords");
  }

  const statements = buildRolePasswordStatements(process.env);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
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
      process.stdout.write(`F4.16: ${role} can now log in.\n`);
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
