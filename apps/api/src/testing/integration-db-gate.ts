import pg from "pg";

/**
 * ADR 0025 decision 8 (`F4.28`) — the one copy of the integration-test database
 * gate.
 *
 * Six suites had grown their own verbatim copy of this before `F4.28`:
 * `asset-templates.instantiate`, `asset-templates.lifecycle`, `audit`,
 * `access-control`, `point-aggregates` and `aggregate-retention`. `F2.1` put the
 * threshold for extracting it at the third suite; `F4.14` recorded it as overdue
 * rather than newly due; `F4.1` and `F4.2` each declined again rather than
 * refactoring five other suites inside a feature change. `F4.28` would have been
 * the seventh, so it lands here in its own commit instead.
 *
 * **The asymmetry is the whole point, and it is easy to copy wrongly.** An unset
 * `DATABASE_URL` is not the same event in the two environments:
 *
 * - **Locally** it means "no database handy" — skip, and say why loudly, because
 *   the coverage thresholds in `vitest.config.ts` are measured with these suites
 *   running and the gate will otherwise fail with a number that explains nothing.
 * - **In CI** it means the pipeline is broken. Skipping there produces a green run
 *   that asserted nothing about the database behaviour the suite exists to check.
 *   So it **throws**.
 *
 * And a *set* `DATABASE_URL` is a claim that a database exists, so a failed
 * connection fails in **both** environments rather than skipping — see
 * {@link openIntegrationPool}.
 *
 * Get that backwards in one of seven copies and the result is a suite that is
 * silently absent from CI while looking green. That is why the verdict below is a
 * pure function of the environment, separate from the effects: it is directly
 * assertable, and `integration-db-gate.spec.ts` mutation-tests it. Asserting only
 * that the six suites still pass would prove nothing — they pass either way on a
 * machine with `DATABASE_URL` set, which is the exact shape of the `F4.1` test
 * that passed under a mutated `avgExpr`.
 */

/** What the environment says should happen. Pure; no effects, no `process` read. */
export type IntegrationDbVerdict =
  | { readonly kind: "run"; readonly connectionString: string }
  | { readonly kind: "skip" }
  | { readonly kind: "refuse" };

/**
 * The decision, as a total function of the two variables that matter.
 *
 * Kept free of `process.env`, `throw` and `stderr` so a test can enumerate all
 * four combinations without touching the ambient environment.
 */
export function integrationDbVerdict(env: {
  DATABASE_URL?: string | undefined;
  CI?: string | undefined;
}): IntegrationDbVerdict {
  const connectionString = env.DATABASE_URL;
  // Exactly the predicate all six copies used. `CI` is set to the string "true"
  // by GitHub Actions; "1" is accepted because other runners use it. Anything
  // else — including "false", "0" and "" — is not CI.
  const isCi = env.CI === "true" || env.CI === "1";
  if (connectionString) {
    return { kind: "run", connectionString };
  }
  return isCi ? { kind: "refuse" } : { kind: "skip" };
}

/**
 * Applies {@link integrationDbVerdict} to the real environment at module scope.
 *
 * Returns the connection string, or `undefined` when the suite must skip — feed
 * it straight to `describe.skipIf(!connectionString)`. Throws when the verdict is
 * `refuse`, which is deliberately an import-time failure: a `describe` that never
 * registers is indistinguishable from one that passed.
 *
 * ## `E7.1a` / ADR 0045 — why the returned string names `bms_fleet` by default
 *
 * `DATABASE_URL` used to name `bms_app`, a superuser, so a fixture pool built
 * from it saw every row in every organization. Since ADR 0045 it names
 * `bms_owner`, which `FORCE ROW LEVEL SECURITY` binds — and a fixture pool with
 * no `app.current_organization` set now sees **nothing** on the five tables
 * migration `0040` protects.
 *
 * Integration fixtures are cross-organization reads by their nature: one suite
 * looks up `wc-admin@bms.local`'s ESKOM grant and `phe-admin@bms.local`'s PHEWB
 * grant in the same `beforeAll`. Under
 * [ADR 0043 Amendment 3](../../../../docs/adr/0043-multi-tenant-architecture.md)
 * that is a `fleetDb` read, and it needs a named reason — **this paragraph is
 * that reason, stated once at the one seam all 34 suites pass through** rather
 * than 34 times.
 *
 * This does *not* weaken the row-level-security coverage. The suites that
 * actually test RLS — `locations.rls`, `point-keys.rls`, `tenant-context`,
 * `access-control-rls` and `role-grants` — each build their own role pools with
 * `asRole` and are unaffected by what this returns. What `E7.1a` adds on top is
 * `bms-owner-rls.integration.*`, which asserts the negative directly.
 *
 * @param item backlog id, e.g. `"F4.28"` — prefixes both messages
 * @param label what the suite covers, e.g. `"aggregate read conversion tests"`
 * @param because why a green run without a database asserts nothing. Suite-
 *   specific and load-bearing: it is what tells whoever broke the pipeline which
 *   guarantee just stopped being checked. Name the behaviours, not the feature.
 * @param connection which role the returned string names. `"fleet"` (the
 *   default) is the fixture connection described above. `"superuser"` is for the
 *   one suite that issues `SET LOCAL ROLE`, which needs the superuser attribute
 *   or role membership — `bms_owner` has neither, on purpose. `"owner"` is for a
 *   suite that means to be bound by `FORCE`.
 */
export function requireIntegrationDb({
  item,
  label,
  because,
  connection = "fleet",
}: {
  item: string;
  label: string;
  because: string;
  connection?: "fleet" | "owner" | "superuser";
}): string | undefined {
  const verdict = integrationDbVerdict(process.env);

  if (verdict.kind === "refuse") {
    throw new Error(
      `${item} ${label} have no DATABASE_URL in CI. Refusing to skip — ${because}`,
    );
  }

  if (verdict.kind === "skip") {
    // `process.stderr.write`, not `console.warn`: Vitest intercepts `console` and
    // discards module-scope output from a skipped file, so the warning that
    // explains the coverage failure would itself be invisible.
    process.stderr.write(
      `\n[${item}] Skipping ${label}: DATABASE_URL is not set.\n` +
        "        Coverage thresholds assume these ran — expect the gate to fail.\n" +
        "        DATABASE_URL=postgres://bms_app:bms_app_dev@localhost:5432/bms pnpm test:coverage\n" +
        "        (5432 is the committed compose port; docker-compose.override.yml may remap it)\n\n",
    );
    return undefined;
  }

  return resolveIntegrationRoleUrl(verdict.connectionString, connection, process.env);
}

/**
 * Re-points a connection string at the role a suite actually needs.
 *
 * Prefers an explicitly-set `DATABASE_URL_FLEET` / `DATABASE_URL_SUPERUSER`
 * over deriving one, so a deployment whose roles are named or credentialed
 * differently is not second-guessed. The derivation is the same one
 * `asRole` performs for the real-role RLS suites, and it exists so a developer
 * sets one variable rather than four.
 */
export function resolveIntegrationRoleUrl(
  connectionString: string,
  connection: "fleet" | "owner" | "superuser",
  env: Record<string, string | undefined>,
): string {
  if (connection === "owner") {
    return connectionString;
  }
  const explicit =
    connection === "fleet" ? env.DATABASE_URL_FLEET : env.DATABASE_URL_SUPERUSER;
  if (explicit) {
    return explicit;
  }
  const [role, password] =
    connection === "fleet"
      ? ["bms_fleet", env.BMS_FLEET_PASSWORD ?? "bms_fleet_dev"]
      : ["bms_app", "bms_app_dev"];
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

/**
 * Opens a pool and proves it reaches the database before any suite depends on it.
 *
 * The other half of the asymmetry: a **set** `DATABASE_URL` is a claim that a
 * database exists, so an unreachable one fails everywhere rather than skipping.
 * Without this, a typo in the connection string degrades to a suite that skips
 * locally and — because the string is set — never trips the CI refusal either.
 *
 * The pool is ended before throwing so a failed `beforeAll` does not leak a
 * handle and hang the runner.
 */
export async function openIntegrationPool(
  connectionString: string,
  item: string,
  poolOptions: { max?: number; connectionTimeoutMillis?: number } = {},
): Promise<pg.Pool> {
  const pool = new pg.Pool({
    connectionString,
    max: poolOptions.max ?? 4,
    connectionTimeoutMillis: poolOptions.connectionTimeoutMillis ?? 5_000,
  });
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    await pool.end().catch(() => undefined);
    // `code` carries the actionable part for the common failures (ECONNREFUSED,
    // ENOTFOUND, 28P01), and `err.message` alone omits it.
    const detail =
      err instanceof Error
        ? [err.message, (err as NodeJS.ErrnoException).code].filter(Boolean).join(" ") ||
          err.name
        : String(err);
    throw new Error(
      `${item} could not reach DATABASE_URL: ${detail}. Setting DATABASE_URL is a claim ` +
        "that a database exists, so this fails rather than skipping.",
    );
  }
  return pool;
}
