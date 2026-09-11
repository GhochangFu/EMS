import { integrationRedisVerdict, requireIntegrationRedis } from "./integration-redis-gate";

/**
 * F4.24 (ADR 0063 decision 13) — the pure half of the integration-test Redis
 * gate, the same table `integration-db-gate.spec.ts` carries for
 * `DATABASE_URL`.
 *
 * The thing under test is a **guard**, and the failure mode of a broken guard
 * is a green run: if the CI branch stops refusing, `queue.integration` silently
 * vanishes from CI while its file still reports as passing — the exact outcome
 * decision 13 exists to refuse. So these assert the verdict **directly**,
 * enumerating all four combinations of the two inputs. Each one fails if the
 * corresponding branch is inverted or dropped. Asserting that
 * `queue.integration` still passes would prove nothing: on a machine with
 * `REDIS_URL` set it passes under every mutation of the CI branch.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The asymmetry, stated as a table. An unset `REDIS_URL` is a different event
 * in the two environments and the whole point of the helper is that it stays
 * different.
 */
export function assertVerdictIsAsymmetric(): void {
  const cases: {
    env: { REDIS_URL?: string; CI?: string };
    expected: "run" | "skip" | "refuse";
    why: string;
  }[] = [
    {
      env: { REDIS_URL: "redis://localhost:6379" },
      expected: "run",
      why: "a set REDIS_URL locally must run the suite",
    },
    {
      env: { REDIS_URL: "redis://localhost:6379", CI: "true" },
      expected: "run",
      why: "a set REDIS_URL in CI must run the suite",
    },
    {
      env: {},
      expected: "skip",
      why: "no Redis and not CI means skip — a developer without Redis is not a broken build",
    },
    {
      env: { CI: "true" },
      expected: "refuse",
      why:
        "no Redis IN CI must refuse. Skipping here is the failure decision 13 exists to " +
        "prevent: a green run that asserted nothing about the queue behaviour",
    },
  ];

  for (const { env, expected, why } of cases) {
    const verdict = integrationRedisVerdict(env);
    assert(
      verdict.kind === expected,
      `integrationRedisVerdict(${JSON.stringify(env)}) gave "${verdict.kind}", expected ` +
        `"${expected}" — ${why}`,
    );
  }
}

/**
 * `CI` is a string, and only two spellings mean CI — the same predicate the
 * database gate uses. `"false"`, `"0"` and `""` are what a shell produces when
 * someone tries to turn CI *off*, and reading any of them as truthy would make
 * every local run without Redis throw.
 */
export function assertCiIsDetectedByValueNotTruthiness(): void {
  for (const value of ["true", "1"]) {
    assert(
      integrationRedisVerdict({ CI: value }).kind === "refuse",
      `CI="${value}" must count as CI`,
    );
  }
  for (const value of ["false", "0", "", "yes", "TRUE"]) {
    assert(
      integrationRedisVerdict({ CI: value }).kind === "skip",
      `CI="${value}" must NOT count as CI — only the exact strings "true" and "1" do, ` +
        "and widening this would make every Redis-less local run throw",
    );
  }
}

/** The URL must come back unaltered — `readQueueConfig` parses it, not the gate. */
export function assertUrlIsReturnedVerbatim(): void {
  const url = "rediss://user:p%40ss@cache.internal:6380/2";
  const verdict = integrationRedisVerdict({ REDIS_URL: url });
  assert(verdict.kind === "run", "a set REDIS_URL must yield a run verdict");
  assert(verdict.kind === "run" && verdict.url === url, "the URL must be returned unaltered");
}

/**
 * The refusal must be a `throw` at module scope, not a skipped `describe`.
 *
 * `describe.skipIf` registers nothing, and a suite that registers nothing is
 * indistinguishable from one that passed — which is exactly the outcome being
 * refused. Also asserts the message carries the caller's `because`: that string
 * is what tells whoever broke the pipeline which guarantee stopped being checked.
 */
export function assertRefusalThrowsWithTheCallersReason(): void {
  const saved = { REDIS_URL: process.env.REDIS_URL, CI: process.env.CI };
  try {
    delete process.env.REDIS_URL;
    process.env.CI = "true";

    let thrown: unknown;
    try {
      requireIntegrationRedis({
        item: "F0.0",
        label: "probe tests",
        because: "SENTINEL-REASON-5c1d",
      });
    } catch (err) {
      thrown = err;
    }

    // `err.name`, never `instanceof` (F4.108).
    const name =
      typeof thrown === "object" && thrown !== null
        ? String((thrown as { name?: unknown }).name)
        : undefined;
    assert(
      name === "Error",
      "requireIntegrationRedis must THROW when REDIS_URL is unset in CI, not return undefined",
    );
    const message = (thrown as { message?: string }).message ?? "";
    assert(
      message.includes("SENTINEL-REASON-5c1d"),
      `the refusal must carry the caller's reason; got: ${message}`,
    );
    assert(message.includes("F0.0"), `the refusal must name the backlog item; got: ${message}`);
  } finally {
    // Restore exactly, including the distinction between "unset" and "empty".
    if (saved.REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = saved.REDIS_URL;
    }
    if (saved.CI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = saved.CI;
    }
  }
}

/**
 * The skip path must return `undefined` and must **write to stderr**, naming
 * the value to set and the compose command that finds the port.
 * `process.stderr.write` rather than `console.warn` is load-bearing: Vitest
 * intercepts `console` and discards module-scope output from a skipped file.
 */
export function assertSkipReturnsUndefinedAndExplainsItself(): void {
  const saved = { REDIS_URL: process.env.REDIS_URL, CI: process.env.CI };
  const written: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  try {
    delete process.env.REDIS_URL;
    delete process.env.CI;
    (process.stderr as unknown as { write: (chunk: string) => boolean }).write = (
      chunk: string,
    ) => {
      written.push(String(chunk));
      return true;
    };

    const result = requireIntegrationRedis({
      item: "F0.0",
      label: "probe tests",
      because: "unused on the skip path",
    });

    assert(
      result === undefined,
      "the skip path must return undefined so describe.skipIf(!redisUrl) skips",
    );
    const note = written.join("");
    assert(
      note.includes("F0.0") && note.includes("probe tests"),
      `the skip note must identify the suite; got: ${note}`,
    );
    assert(
      note.includes("REDIS_URL=redis://localhost:6379"),
      `the skip note must name the value to set; got: ${note}`,
    );
    assert(
      note.includes("docker compose port redis 6379"),
      `the skip note must name the command that finds a remapped port; got: ${note}`,
    );
  } finally {
    (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
    if (saved.REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = saved.REDIS_URL;
    }
    if (saved.CI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = saved.CI;
    }
  }
}
