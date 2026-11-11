/**
 * `F4.5` (ADR 0124 decision 5, ruling 6) — which database and Redis a test run uses.
 *
 * The global setup reads this verdict once. It keeps the asymmetry the two integration gates
 * already have (`integration-db-gate.ts`, `integration-redis-gate.ts`): with nothing to run
 * against, a local run skips and a `CI` run refuses, because a green run that silently skipped
 * the database suites asserts nothing.
 *
 * Order:
 * 1. `BMS_TEST_DB=containers` → containers; refused without Docker, even locally, because it is
 *    an explicit claim. This is what CI's test step sets, and it beats the job-scope
 *    `DATABASE_URL` the migration-validation steps use.
 * 2. `BMS_TEST_DB=external|shared`, or a set `DATABASE_URL` → that server. `shared` keeps
 *    today's single shared database; otherwise each worker gets its own copy there.
 * 3. Docker answers → containers.
 * 4. Otherwise skip locally, refuse under `CI`.
 *
 * `BMS_TEST_DB=none` (PR 2) starts nothing and leaves the environment as it is, for a run that
 * holds no database suite — CI's docs-only job runs the `repo` invariants with Docker present
 * and no `DATABASE_URL`, and would otherwise start containers it never uses. A database suite in
 * such a run still meets its own gate (skip locally, refuse under `CI`).
 */

export type TestInfraMode =
  | { readonly kind: "containers" }
  | { readonly kind: "none" }
  | { readonly kind: "external"; readonly databaseUrl: string; readonly isolate: boolean }
  | { readonly kind: "skip"; readonly reason: string }
  | { readonly kind: "refuse"; readonly reason: string };

export type TestInfraEnv = {
  readonly BMS_TEST_DB?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly CI?: string | undefined;
};

const KNOWN_MODES = new Set(["containers", "external", "shared", "none"]);

/** The run's one verdict: containers, an external server, skip, or refuse. */
export function testInfraMode(env: TestInfraEnv, dockerAnswers: boolean): TestInfraMode {
  const requested = env.BMS_TEST_DB?.trim() || undefined;
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const isCi = env.CI === "true" || env.CI === "1";

  if (requested !== undefined && !KNOWN_MODES.has(requested)) {
    return {
      kind: "refuse",
      reason: `BMS_TEST_DB=${requested} is not one of containers, external, shared, none.`,
    };
  }

  if (requested === "none") {
    return { kind: "none" };
  }

  if (requested === "containers") {
    return dockerAnswers
      ? { kind: "containers" }
      : { kind: "refuse", reason: "BMS_TEST_DB=containers is set but Docker does not answer." };
  }

  if (requested === "external" || requested === "shared" || databaseUrl !== undefined) {
    if (databaseUrl === undefined) {
      return { kind: "refuse", reason: `BMS_TEST_DB=${String(requested)} needs DATABASE_URL.` };
    }
    return { kind: "external", databaseUrl, isolate: requested !== "shared" };
  }

  if (dockerAnswers) {
    return { kind: "containers" };
  }

  const reason =
    "Docker does not answer and DATABASE_URL is not set, so there is no database to run the " +
    "integration suites against. Start Docker, or set DATABASE_URL to a prepared database.";
  return isCi ? { kind: "refuse", reason } : { kind: "skip", reason };
}

/**
 * Whether Docker's answer can change `testInfraMode`'s verdict, so the global setup probes the
 * daemon only then. `BMS_TEST_DB=containers` always needs it — including beside a set
 * `DATABASE_URL`, which is CI's test step.
 */
export function dockerDecides(env: TestInfraEnv): boolean {
  const requested = env.BMS_TEST_DB?.trim() || undefined;
  if (requested === "containers") return true;
  return requested === undefined && !env.DATABASE_URL?.trim();
}
