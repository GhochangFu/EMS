import {
  buildIdentityAdminConfig,
  type IdentityAdminConfig,
} from "../identity/identity-admin.config";

/**
 * `F3.78` (ADR 0089, plan D6, owner ruling Q-A) — the Keycloak
 * integration-test gate, the `KEYCLOAK_ADMIN_URL` twin of
 * `integration-storage-gate.ts`.
 *
 * **An unset `KEYCLOAK_ADMIN_URL` is a different event in the two
 * environments.** Locally it means "no Keycloak configured for tests" — skip,
 * with the one line plan D6 names. In CI it means the workflow is broken —
 * `ci.yml` starts Keycloak and exports the four variables (Q-A: the spec runs
 * on every code PR) — so the gate **throws**, at import time, because a
 * `describe` that never registers is indistinguishable from one that passed.
 *
 * **A set URL is a claim that Keycloak exists.** The gate builds the client's
 * configuration through `buildIdentityAdminConfig`, the same function the API
 * uses, and a `null` there throws in every environment: a misconfigured URL
 * (`http://localhost:8080`, which decision 5's rule refuses) or a missing
 * secret must never read as a skip. That refusal wins over a declared skip.
 *
 * **`KEYCLOAK_INTEGRATION=skip`** (exactly that string) is the Q-A
 * alternative: a job that deliberately does not run Keycloak declares so, and
 * the gate writes a verdict line instead of throwing.
 *
 * The verdict is a pure function of the environment, so
 * `keycloak-gate.spec.ts` enumerates every branch without a Keycloak.
 */

export type KeycloakGateVerdict =
  | { readonly kind: "run"; readonly config: IdentityAdminConfig }
  | { readonly kind: "skip" }
  | { readonly kind: "declared-skip" }
  | { readonly kind: "refuse-unset" }
  | { readonly kind: "refuse-misconfigured"; readonly warnings: readonly string[] };

/** The decision. Pure; reads only the object it is given. */
export function keycloakGateVerdict(env: NodeJS.ProcessEnv): KeycloakGateVerdict {
  const url = env.KEYCLOAK_ADMIN_URL?.trim();
  // The same CI predicate the database, Redis and storage gates use.
  const isCi = env.CI === "true" || env.CI === "1";
  const declaredSkip = env.KEYCLOAK_INTEGRATION === "skip";

  if (url) {
    const warnings: string[] = [];
    const config = buildIdentityAdminConfig(env, (message) => warnings.push(message));
    if (config === null) {
      return { kind: "refuse-misconfigured", warnings };
    }
    return declaredSkip ? { kind: "declared-skip" } : { kind: "run", config };
  }
  if (declaredSkip) {
    return { kind: "declared-skip" };
  }
  return isCi ? { kind: "refuse-unset" } : { kind: "skip" };
}

/**
 * Applies {@link keycloakGateVerdict} to `process.env` at module scope.
 *
 * Returns the configuration, or `undefined` when the suite must skip — feed it
 * to `describe.skipIf(!config)`. Throws on either refusal. Every message names
 * variables and never a value (§9.6).
 *
 * @param item backlog id, e.g. `"F3.78"`
 * @param label what the suite is, e.g. `"Keycloak integration spec"`
 * @param because why a green run without Keycloak asserts nothing
 */
export function requireKeycloak({
  item,
  label,
  because,
}: {
  item: string;
  label: string;
  because: string;
}): IdentityAdminConfig | undefined {
  const verdict = keycloakGateVerdict(process.env);

  switch (verdict.kind) {
    case "run":
      return verdict.config;
    case "skip":
      // `process.stderr.write`, not `console`: Vitest discards module-scope
      // console output from a skipped file.
      process.stderr.write(`${item}: ${label} skipped — KEYCLOAK_ADMIN_URL unset\n`);
      return undefined;
    case "declared-skip":
      process.stderr.write(
        `${item}: ${label} skipped — KEYCLOAK_INTEGRATION=skip is set, so this job declared it does not run Keycloak\n`,
      );
      return undefined;
    case "refuse-unset":
      throw new Error(
        `${item} ${label}: KEYCLOAK_ADMIN_URL is unset in CI. Refusing to skip — ${because}`,
      );
    case "refuse-misconfigured":
      throw new Error(
        `${item} ${label}: KEYCLOAK_ADMIN_URL is set but the configuration is refused ` +
          `(${verdict.warnings.join(" ")}). Setting KEYCLOAK_ADMIN_URL is a claim that Keycloak ` +
          "exists, so this fails rather than skipping. Check KEYCLOAK_ADMIN_URL, KEYCLOAK_ADMIN_REALM, " +
          "KEYCLOAK_ADMIN_CLIENT_ID and KEYCLOAK_ADMIN_CLIENT_SECRET.",
      );
  }
}
