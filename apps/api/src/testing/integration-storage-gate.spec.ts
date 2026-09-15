import { integrationStorageVerdict, requireIntegrationStorage } from "./integration-storage-gate";

/**
 * `F3.3` (ADR 0066 decision 10) — the pure half of the integration-test
 * object-storage gate, the table `integration-redis-gate.spec.ts` carries for
 * `REDIS_URL`.
 *
 * The thing under test is a **guard**, and the failure mode of a broken guard
 * is a green run: if the CI branch stops refusing, `storage.integration`
 * silently vanishes from CI while its file still reports as passing — the exact
 * outcome decision 10 exists to refuse. So these assert the verdict
 * **directly**, enumerating all four combinations of the two inputs, and then
 * the third state the Redis gate does not have: a set endpoint whose
 * configuration is broken must **fail**, never skip.
 *
 * Every function here restores `process.env` exactly, including the difference
 * between "unset" and "empty".
 */

/** The six variables a real run sets. Written once so the restore cannot miss one. */
const STORAGE_KEYS = [
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_ALLOW_INSECURE",
  "OBJECT_STORAGE_FORCE_PATH_STYLE",
  "CI",
] as const;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Runs `fn` with exactly `env` set for the storage keys, and restores every one. */
function withEnv<T>(env: Partial<Record<(typeof STORAGE_KEYS)[number], string>>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const key of STORAGE_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of STORAGE_KEYS) {
      const value = saved.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/** Captures a throw. A call that returns fails here, never inside the `catch`. */
function captureThrow(run: () => unknown): unknown {
  let thrown: unknown;
  let returned = false;
  try {
    run();
    returned = true;
  } catch (err) {
    thrown = err;
  }
  if (returned) {
    throw new Error("expected the call to throw, but it returned");
  }
  return thrown;
}

/**
 * The asymmetry, stated as a table. An unset `OBJECT_STORAGE_ENDPOINT` is a
 * different event in the two environments and the whole point of the helper is
 * that it stays different.
 */
export function assertVerdictIsAsymmetric(): void {
  const cases: {
    env: { OBJECT_STORAGE_ENDPOINT?: string; CI?: string };
    expected: "run" | "skip" | "refuse";
    why: string;
  }[] = [
    {
      env: { OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000" },
      expected: "run",
      why: "a set endpoint locally must run the suite",
    },
    {
      env: { OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000", CI: "true" },
      expected: "run",
      why: "a set endpoint in CI must run the suite",
    },
    {
      env: {},
      expected: "skip",
      why: "no MinIO and not CI means skip — a developer without MinIO is not a broken build",
    },
    {
      env: { CI: "true" },
      expected: "refuse",
      why:
        "no endpoint IN CI must refuse. Skipping here is the failure decision 10 exists to " +
        "prevent: a green run in which putObject → row → content was never proved",
    },
  ];

  for (const { env, expected, why } of cases) {
    const verdict = integrationStorageVerdict(env);
    assert(
      verdict.kind === expected,
      `integrationStorageVerdict(${JSON.stringify(env)}) gave "${verdict.kind}", expected ` +
        `"${expected}" — ${why}`,
    );
  }
}

/**
 * `CI` is a string, and only two spellings mean CI — the same predicate the
 * database and Redis gates use. `"false"`, `"0"` and `""` are what a shell
 * produces when someone tries to turn CI *off*, and reading any of them as
 * truthy would make every local run without MinIO throw.
 */
export function assertCiIsDetectedByValueNotTruthiness(): void {
  for (const value of ["true", "1"]) {
    assert(
      integrationStorageVerdict({ CI: value }).kind === "refuse",
      `CI="${value}" must count as CI`,
    );
  }
  for (const value of ["false", "0", "", "yes", "TRUE"]) {
    assert(
      integrationStorageVerdict({ CI: value }).kind === "skip",
      `CI="${value}" must NOT count as CI — only the exact strings "true" and "1" do, ` +
        "and widening this would make every MinIO-less local run throw",
    );
  }
}

/** The endpoint must come back unaltered — `readStorageConfig` parses it, not the verdict. */
export function assertEndpointIsReturnedVerbatim(): void {
  const endpoint = "https://s3.example.internal:9000/";
  const verdict = integrationStorageVerdict({ OBJECT_STORAGE_ENDPOINT: endpoint });
  assert(verdict.kind === "run", "a set endpoint must yield a run verdict");
  assert(
    verdict.kind === "run" && verdict.endpoint === endpoint,
    "the endpoint must be returned unaltered",
  );
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
  const thrown = withEnv({ CI: "true" }, () =>
    captureThrow(() =>
      requireIntegrationStorage({
        item: "F0.0",
        label: "probe tests",
        because: "SENTINEL-REASON-9b2e",
      }),
    ),
  );

  // `err.name`, never `instanceof` (F4.108).
  const name =
    typeof thrown === "object" && thrown !== null
      ? String((thrown as { name?: unknown }).name)
      : undefined;
  assert(
    name === "Error",
    "requireIntegrationStorage must THROW when the endpoint is unset in CI, not return undefined",
  );
  const message = (thrown as { message?: string }).message ?? "";
  assert(
    message.includes("SENTINEL-REASON-9b2e"),
    `the refusal must carry the caller's reason; got: ${message}`,
  );
  assert(message.includes("F0.0"), `the refusal must name the backlog item; got: ${message}`);
  assert(
    message.includes("OBJECT_STORAGE_ENDPOINT"),
    `the refusal must name the variable that is missing; got: ${message}`,
  );
}

/** Captures everything written to stderr while `fn` runs. */
function capturingStderr<T>(fn: () => T): { result: T; written: string } {
  const written: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    written.push(String(chunk));
    return true;
  };
  try {
    return { result: fn(), written: written.join("") };
  } finally {
    (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
  }
}

/**
 * The skip path must return `undefined` and must **write to stderr**, naming
 * every variable a run needs and the compose command that starts MinIO.
 * `process.stderr.write` rather than `console.warn` is load-bearing: Vitest
 * intercepts `console` and discards module-scope output from a skipped file.
 */
export function assertSkipReturnsUndefinedAndExplainsItself(): void {
  const { result, written } = withEnv({}, () =>
    capturingStderr(() =>
      requireIntegrationStorage({
        item: "F0.0",
        label: "probe tests",
        because: "unused on the skip path",
      }),
    ),
  );

  assert(
    result === undefined,
    "the skip path must return undefined so describe.skipIf(!config) skips",
  );
  assert(
    written.includes("F0.0") && written.includes("probe tests"),
    `the skip note must identify the suite; got: ${written}`,
  );
  for (const variable of [
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
    "OBJECT_STORAGE_REGION",
    "OBJECT_STORAGE_ALLOW_INSECURE",
  ]) {
    assert(
      written.includes(variable),
      `the skip note must name ${variable} — six variables are needed, not one; got: ${written}`,
    );
  }
  assert(
    written.includes("docker compose --profile core up -d minio"),
    `the skip note must name the command that starts MinIO; got: ${written}`,
  );
}

/** A complete, valid configuration comes back parsed — the positive control for the two below. */
export function assertRunReturnsTheParsedConfig(): void {
  const config = withEnv(
    {
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_BUCKET: "bms-asset-images",
      OBJECT_STORAGE_ACCESS_KEY: "probe-access",
      OBJECT_STORAGE_SECRET_KEY: "probe-secret",
      OBJECT_STORAGE_ALLOW_INSECURE: "true",
    },
    () =>
      requireIntegrationStorage({
        item: "F0.0",
        label: "probe tests",
        because: "unused on the run path",
      }),
  );

  assert(config !== undefined, "a complete configuration must not skip");
  assert(config?.kind === "configured", "the run path must return the CONFIGURED config");
  assert(
    config?.bucket === "bms-asset-images",
    `the parsed bucket must be the one in the environment; got: ${String(config?.bucket)}`,
  );
  assert(
    config?.region === "us-east-1",
    `the default region must be parsed, not invented by the gate; got: ${String(config?.region)}`,
  );
}

/**
 * A set endpoint is a claim that an object store exists, so a **broken**
 * configuration fails rather than skipping.
 *
 * Without this, a plain-`http` endpoint with no `OBJECT_STORAGE_ALLOW_INSECURE`
 * — the single likeliest local typo — would degrade to a suite that skips
 * locally and, because the endpoint is set, never trips the CI refusal either.
 * The thrown error is `readStorageConfig`'s own, matched by `name`.
 */
export function assertAConfigErrorFailsRatherThanSkipping(): void {
  const { result: thrown, written } = withEnv(
    {
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_BUCKET: "bms-asset-images",
      OBJECT_STORAGE_ACCESS_KEY: "probe-access",
      OBJECT_STORAGE_SECRET_KEY: "probe-secret",
      // OBJECT_STORAGE_ALLOW_INSECURE deliberately absent.
    },
    () =>
      capturingStderr(() =>
        captureThrow(() =>
          requireIntegrationStorage({
            item: "F0.0",
            label: "probe tests",
            because: "unused on the failure path",
          }),
        ),
      ),
  );

  const name =
    typeof thrown === "object" && thrown !== null
      ? String((thrown as { name?: unknown }).name)
      : undefined;
  assert(
    name === "StorageConfigError",
    `a broken configuration must throw StorageConfigError, not skip; got name: ${String(name)}`,
  );
  // The adjacent negative: it must not ALSO have written the skip note, which
  // would mean the gate skipped and something else threw.
  assert(
    written === "",
    `a broken configuration must not print the skip note; got: ${written}`,
  );
}

/**
 * The bucket is one of the six, and its absence is a configuration error too —
 * a second guard, so the row above cannot pass because only the `http` branch
 * survived. The message names the variable and never a value (§9.6).
 */
export function assertAMissingBucketFailsWithoutEchoingTheEndpoint(): void {
  const thrown = withEnv(
    {
      OBJECT_STORAGE_ENDPOINT: "https://s3cret-host.example",
      OBJECT_STORAGE_ACCESS_KEY: "probe-access",
      OBJECT_STORAGE_SECRET_KEY: "s3cr3tvalue",
    },
    () =>
      captureThrow(() =>
        requireIntegrationStorage({
          item: "F0.0",
          label: "probe tests",
          because: "unused on the failure path",
        }),
      ),
  );

  const message = (thrown as { message?: string }).message ?? "";
  assert(
    message.includes("OBJECT_STORAGE_BUCKET"),
    `the refusal must name the missing variable; got: ${message}`,
  );
  assert(
    !message.includes("s3cret-host.example") && !message.includes("s3cr3tvalue"),
    `the refusal must carry neither the endpoint nor the secret (§9.6); got: ${message}`,
  );
}
