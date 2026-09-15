import { readStorageConfig, type StorageConfig } from "../storage/storage-config";

/**
 * `F3.3` (ADR 0066 decision 10) — the integration-test object-storage gate,
 * the `OBJECT_STORAGE_ENDPOINT` twin of `integration-redis-gate.ts`.
 *
 * **The asymmetry is the whole point, and it is easy to copy wrongly.** An
 * unset `OBJECT_STORAGE_ENDPOINT` is not the same event in the two
 * environments:
 *
 * - **Locally** it means "no MinIO handy" — skip, and say why on stderr,
 *   naming all six variables and the compose command that starts the
 *   service, because the coverage thresholds in `vitest.config.ts` are
 *   measured with the storage suite running.
 * - **In CI** it means the pipeline is broken — `ci.yml` starts MinIO and
 *   exports the six values, so an unset endpoint there is a workflow edit,
 *   not an environment choice. Skipping would produce a green run in which
 *   `putObject → row → GET …/content` was never proved end to end, which is
 *   the outcome decision 10 exists to refuse. So it **throws**.
 *
 * And a *set* endpoint is a claim that an object store exists, so a
 * **malformed** configuration fails in both environments rather than
 * skipping — see {@link requireIntegrationStorage}. A typo in
 * `OBJECT_STORAGE_FORCE_PATH_STYLE` must not degrade to a suite that skips
 * locally and, because the endpoint is set, never trips the CI refusal
 * either.
 *
 * The verdict is a pure function of the environment, separate from the
 * effects, so `integration-storage-gate.spec.ts` enumerates all four
 * combinations directly. Asserting only that the storage suite still passes
 * would prove nothing — on a machine with the endpoint set it passes under
 * every mutation of the CI branch.
 */

/** What the environment says should happen. Pure; no effects, no `process` read. */
export type IntegrationStorageVerdict =
  | { readonly kind: "run"; readonly endpoint: string }
  | { readonly kind: "skip" }
  | { readonly kind: "refuse" };

/**
 * The decision, as a total function of the two variables that matter — the
 * same CI predicate the database and Redis gates use, so the three cannot
 * drift on what counts as CI.
 */
export function integrationStorageVerdict(env: {
  OBJECT_STORAGE_ENDPOINT?: string | undefined;
  CI?: string | undefined;
}): IntegrationStorageVerdict {
  const endpoint = env.OBJECT_STORAGE_ENDPOINT;
  // `CI` is set to the string "true" by GitHub Actions; "1" is accepted because
  // other runners use it. Anything else — including "false", "0" and "" — is not CI.
  const isCi = env.CI === "true" || env.CI === "1";
  if (endpoint) {
    return { kind: "run", endpoint };
  }
  return isCi ? { kind: "refuse" } : { kind: "skip" };
}

/** The configured variant — what a suite that reached the run branch actually needs. */
export type ConfiguredStorageConfig = Extract<StorageConfig, { kind: "configured" }>;

/**
 * Applies {@link integrationStorageVerdict} to the real environment at module
 * scope and parses the configuration behind it.
 *
 * Returns the parsed `StorageConfig`, or `undefined` when the suite must skip
 * — feed it straight to `describe.skipIf(!storageConfig)`. Throws when the
 * verdict is `refuse`, which is deliberately an import-time failure: a
 * `describe` that never registers is indistinguishable from one that passed.
 *
 * **A set endpoint with a broken configuration fails here.** `readStorageConfig`
 * throws `StorageConfigError` for every guard it owns (a bad URL, a plain-http
 * endpoint without `OBJECT_STORAGE_ALLOW_INSECURE`, a missing bucket or
 * credential) and that error passes through untouched rather than being caught
 * into a skip. Its messages name the variable and never a value (§9.6), so
 * nothing this function throws carries the endpoint or a secret.
 *
 * @param item backlog id, e.g. `"F3.3"` — prefixes both messages
 * @param label what the suite covers, e.g. `"object storage integration tests"`
 * @param because why a green run without an object store asserts nothing.
 *   Suite-specific and load-bearing: it is what tells whoever broke the
 *   pipeline which guarantee just stopped being checked.
 */
export function requireIntegrationStorage({
  item,
  label,
  because,
}: {
  item: string;
  label: string;
  because: string;
}): ConfiguredStorageConfig | undefined {
  const verdict = integrationStorageVerdict(process.env);

  if (verdict.kind === "refuse") {
    throw new Error(
      `${item} ${label} have no OBJECT_STORAGE_ENDPOINT in CI. Refusing to skip — ${because}`,
    );
  }

  if (verdict.kind === "skip") {
    // `process.stderr.write`, not `console.warn`: Vitest intercepts `console` and
    // discards module-scope output from a skipped file, so the warning that
    // explains the coverage failure would itself be invisible.
    process.stderr.write(
      `\n[${item}] Skipping ${label}: OBJECT_STORAGE_ENDPOINT is not set.\n` +
        "        Coverage thresholds assume these ran — expect the gate to fail.\n" +
        "        docker compose --profile core up -d minio\n" +
        "        OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000 OBJECT_STORAGE_BUCKET=bms-asset-images \\\n" +
        "        OBJECT_STORAGE_ACCESS_KEY=bms_minio_dev OBJECT_STORAGE_SECRET_KEY=bms_minio_dev_secret \\\n" +
        "        OBJECT_STORAGE_ALLOW_INSECURE=true OBJECT_STORAGE_REGION=us-east-1 pnpm test:coverage\n" +
        "        (9000 is the committed compose port; `docker compose port minio 9000` prints the one in use)\n\n",
    );
    return undefined;
  }

  const config = readStorageConfig(process.env);
  if (config.kind !== "configured") {
    throw new Error(
      `${item}: OBJECT_STORAGE_ENDPOINT is set but readStorageConfig read it as unconfigured ` +
        "(whitespace-only?). Setting the endpoint is a claim that an object store exists, so " +
        "this fails rather than skipping.",
    );
  }
  return config;
}
