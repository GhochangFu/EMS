import pg from "pg";

/**
 * `F2.7` — the `apps/ingest` copy of the integration-test database gate.
 *
 * Copied from two files, both under `apps/api/src/testing/`:
 * `integration-db-gate.ts` (the asymmetric verdict, the skip message and
 * `openIntegrationPool`) and `role-urls.ts` (deriving a real role's connection
 * string from the owner's `DATABASE_URL`, so a developer sets one variable
 * rather than four).
 *
 * **A copy, and deliberately so.** `apps/ingest` imports `packages/shared` and
 * nothing else — it is a standalone Node process with its own `tsconfig` and its
 * own dependency list, and a cross-app import would make the ingest host's build
 * depend on a NestJS app's. Hoisting the gate into `packages/shared` is the
 * other alternative and is worse: it would put `pg` and a `process.env` read
 * into the one package `apps/web` bundles.
 *
 * **The asymmetry is the whole point, and it is easy to copy wrongly** — that is
 * the source file's own warning, and this is now the second copy, so it is
 * repeated rather than referenced:
 *
 * - **Locally** an unset `DATABASE_URL` means "no database handy" → skip, and say
 *   so on stderr, because `vitest.config.ts`'s coverage thresholds are measured
 *   with these suites running.
 * - **In CI** it means the pipeline is broken → throw. Skipping there is a green
 *   run that asserted nothing about the behaviour the suite exists to check.
 * - A *set* `DATABASE_URL` is a claim that a database exists, so an unreachable
 *   one fails in **both** environments rather than skipping.
 *
 * The verdict is a pure function of the environment, separate from the effects,
 * so `integration-db-gate.spec.ts` can enumerate all four combinations. That
 * spec is what stops this copy drifting away from the original in the one
 * direction nothing else would notice.
 */

/** What the environment says should happen. Pure; no effects, no `process` read. */
export type IntegrationDbVerdict =
  | { readonly kind: "run"; readonly connectionString: string }
  | { readonly kind: "skip" }
  | { readonly kind: "refuse" };

/** The decision, as a total function of the two variables that matter. */
export function integrationDbVerdict(env: {
  DATABASE_URL?: string | undefined;
  CI?: string | undefined;
}): IntegrationDbVerdict {
  const connectionString = env.DATABASE_URL;
  // `CI` is set to the string "true" by GitHub Actions; "1" is accepted because
  // other runners use it. Anything else — including "false", "0" and "" — is not CI.
  const isCi = env.CI === "true" || env.CI === "1";
  if (connectionString) {
    return { kind: "run", connectionString };
  }
  return isCi ? { kind: "refuse" } : { kind: "skip" };
}

/**
 * Re-points the owner connection string at `bms_fleet`.
 *
 * `role-urls.ts`'s `asRole`, narrowed to the one role this app's suites need.
 * An explicitly-set `DATABASE_URL_FLEET` wins, so a deployment whose roles are
 * named or credentialed differently is not second-guessed. `bms_fleet` is the
 * `BYPASSRLS` read role (ADR 0045): a binding-query fixture is a
 * cross-organization read by nature, and the ingest host itself runs as a role
 * that sees every tenant's bindings.
 */
export function resolveFleetUrl(
  connectionString: string,
  env: Record<string, string | undefined>,
): string {
  const explicit = env.DATABASE_URL_FLEET;
  if (explicit) {
    return explicit;
  }
  const parsed = new URL(connectionString);
  parsed.username = "bms_fleet";
  parsed.password = env.BMS_FLEET_PASSWORD ?? "bms_fleet_dev";
  return parsed.toString();
}

/**
 * Applies {@link integrationDbVerdict} to the real environment at module scope.
 *
 * Returns the fleet connection string, or `undefined` when the suite must skip —
 * feed it straight to `describe.skipIf(!connectionString)`. Throws when the
 * verdict is `refuse`, deliberately at import time: a `describe` that never
 * registers is indistinguishable from one that passed.
 *
 * @param item backlog id, e.g. `"F2.7"` — prefixes both messages
 * @param label what the suite covers
 * @param because why a green run without a database asserts nothing
 */
export function requireIntegrationDb({
  item,
  label,
  because,
}: {
  item: string;
  label: string;
  because: string;
}): string | undefined {
  const verdict = integrationDbVerdict(process.env);

  if (verdict.kind === "refuse") {
    throw new Error(`${item} ${label} have no DATABASE_URL in CI. Refusing to skip — ${because}`);
  }

  if (verdict.kind === "skip") {
    // `process.stderr.write`, not `console.warn`: Vitest intercepts `console`
    // and discards module-scope output from a skipped file, so the warning that
    // explains the coverage failure would itself be invisible.
    process.stderr.write(
      `\n[${item}] Skipping ${label}: DATABASE_URL is not set.\n` +
        "        Coverage thresholds assume these ran — expect the gate to fail.\n" +
        "        DATABASE_URL=postgres://bms_owner:bms_owner_dev@localhost:5432/bms pnpm test\n" +
        "        (5432 is the committed compose port; docker-compose.override.yml may remap it)\n\n",
    );
    return undefined;
  }

  return resolveFleetUrl(verdict.connectionString, process.env);
}

/**
 * Opens a pool and proves it reaches the database before any suite depends on it.
 *
 * The other half of the asymmetry: a **set** `DATABASE_URL` is a claim that a
 * database exists, so an unreachable one fails everywhere rather than skipping.
 * The pool is ended before throwing so a failed `beforeAll` does not leak a
 * handle and hang the runner.
 */
export async function openIntegrationPool(
  connectionString: string,
  item: string,
): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 });
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    await pool.end().catch(() => undefined);
    // `code` carries the actionable part for the common failures (ECONNREFUSED,
    // ENOTFOUND, 28P01), and `err.message` alone omits it.
    const detail =
      err instanceof Error
        ? [err.message, (err as NodeJS.ErrnoException).code].filter(Boolean).join(" ") || err.name
        : String(err);
    throw new Error(
      `${item} could not reach DATABASE_URL: ${detail}. Setting DATABASE_URL is a claim ` +
        "that a database exists, so this fails rather than skipping.",
    );
  }
  return pool;
}
