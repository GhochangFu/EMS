import { integrationDbVerdict, requireIntegrationDb } from "./integration-db-gate";

/**
 * ADR 0025 decision 8 (`F4.28`) — the pure half of the integration-test gate.
 *
 * This suite exists because the thing being extracted is a **guard**, and the
 * failure mode of a broken guard is a green run. Six suites depend on it; if the
 * CI branch stops refusing, all six silently vanish from CI while their files
 * still report as passing.
 *
 * So these assert the verdict **directly**, enumerating all four combinations of
 * the two inputs. Each one fails if the corresponding branch is inverted or
 * dropped — which is the discrimination `avgExpr` did not have in `F4.1`, where a
 * test written for the defect passed with the defect installed. Asserting that
 * the six suites still pass would prove nothing here: on a machine with
 * `DATABASE_URL` set they pass under every mutation of the CI branch.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The asymmetry, stated as a table. An unset `DATABASE_URL` is a different event
 * in the two environments and the whole point of the helper is that it stays
 * different.
 */
export function assertVerdictIsAsymmetric(): void {
  const cases: {
    env: { DATABASE_URL?: string; CI?: string };
    expected: "run" | "skip" | "refuse";
    why: string;
  }[] = [
    {
      env: { DATABASE_URL: "postgres://u:p@localhost:5432/bms" },
      expected: "run",
      why: "a set DATABASE_URL locally must run the suite",
    },
    {
      env: { DATABASE_URL: "postgres://u:p@localhost:5432/bms", CI: "true" },
      expected: "run",
      why: "a set DATABASE_URL in CI must run the suite",
    },
    {
      env: {},
      expected: "skip",
      why: "no database and not CI means skip — a developer without a database is not a broken build",
    },
    {
      env: { CI: "true" },
      expected: "refuse",
      why:
        "no database IN CI must refuse. Skipping here is the failure this gate exists to " +
        "prevent: a green run that asserted nothing about any database behaviour",
    },
  ];

  for (const { env, expected, why } of cases) {
    const verdict = integrationDbVerdict(env);
    assert(
      verdict.kind === expected,
      `integrationDbVerdict(${JSON.stringify(env)}) gave "${verdict.kind}", expected ` +
        `"${expected}" — ${why}`,
    );
  }
}

/**
 * `CI` is a string, and only two spellings mean CI. `"false"`, `"0"` and `""` are
 * what a shell produces when someone tries to turn CI *off*, and reading any of
 * them as truthy would make every local run without a database throw — the
 * inverse failure, which is loud rather than silent but still wrong.
 */
export function assertCiIsDetectedByValueNotTruthiness(): void {
  for (const value of ["true", "1"]) {
    assert(
      integrationDbVerdict({ CI: value }).kind === "refuse",
      `CI="${value}" must count as CI`,
    );
  }
  for (const value of ["false", "0", "", "yes", "TRUE"]) {
    assert(
      integrationDbVerdict({ CI: value }).kind === "skip",
      `CI="${value}" must NOT count as CI — only the exact strings "true" and "1" do, ` +
        "and widening this would make every databaseless local run throw",
    );
  }
}

/** The connection string must come back unaltered — it is passed straight to `pg`. */
export function assertConnectionStringIsReturnedVerbatim(): void {
  const connectionString = "postgres://bms_app:bms_app_dev@localhost:5433/bms?sslmode=disable";
  const verdict = integrationDbVerdict({ DATABASE_URL: connectionString });
  assert(verdict.kind === "run", "a set DATABASE_URL must yield a run verdict");
  assert(
    verdict.kind === "run" && verdict.connectionString === connectionString,
    "the connection string must be returned unaltered",
  );
}

/**
 * The refusal must be a `throw` at module scope, not a skipped `describe`.
 *
 * `describe.skipIf` registers nothing, and a suite that registers nothing is
 * indistinguishable from one that passed — which is exactly the outcome being
 * refused. Also asserts the message carries the caller's `because`: that string is
 * what tells whoever broke the pipeline which guarantee stopped being checked.
 */
export function assertRefusalThrowsWithTheCallersReason(): void {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, CI: process.env.CI };
  try {
    delete process.env.DATABASE_URL;
    process.env.CI = "true";

    let thrown: unknown;
    try {
      requireIntegrationDb({
        item: "F0.0",
        label: "probe tests",
        because: "SENTINEL-REASON-8f3a",
      });
    } catch (err) {
      thrown = err;
    }

    assert(
      thrown instanceof Error,
      "requireIntegrationDb must THROW when DATABASE_URL is unset in CI, not return undefined",
    );
    const message = thrown instanceof Error ? thrown.message : "";
    assert(
      message.includes("SENTINEL-REASON-8f3a"),
      `the refusal must carry the caller's reason; got: ${message}`,
    );
    assert(
      message.includes("F0.0"),
      `the refusal must name the backlog item; got: ${message}`,
    );
  } finally {
    // Restore exactly, including the distinction between "unset" and "empty".
    if (saved.DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = saved.DATABASE_URL;
    }
    if (saved.CI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = saved.CI;
    }
  }
}

/**
 * The skip path must return `undefined` and must **write to stderr**, because the
 * coverage gate is what fails next and the number it fails with explains nothing.
 * `process.stderr.write` rather than `console.warn` is load-bearing: Vitest
 * intercepts `console` and discards module-scope output from a skipped file.
 */
export function assertSkipReturnsUndefinedAndExplainsItself(): void {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, CI: process.env.CI };
  const written: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  try {
    delete process.env.DATABASE_URL;
    delete process.env.CI;
    (process.stderr as unknown as { write: (chunk: string) => boolean }).write = (
      chunk: string,
    ) => {
      written.push(String(chunk));
      return true;
    };

    const result = requireIntegrationDb({
      item: "F0.0",
      label: "probe tests",
      because: "unused on the skip path",
    });

    assert(
      result === undefined,
      "the skip path must return undefined so describe.skipIf(!connectionString) skips",
    );
    const note = written.join("");
    assert(
      note.includes("F0.0") && note.includes("probe tests"),
      `the skip note must identify the suite; got: ${note}`,
    );
    assert(
      note.includes("Coverage thresholds assume these ran"),
      `the skip note must explain the coverage failure that follows; got: ${note}`,
    );
  } finally {
    (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
    if (saved.DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = saved.DATABASE_URL;
    }
    if (saved.CI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = saved.CI;
    }
  }
}
