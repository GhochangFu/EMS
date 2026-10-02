import { keycloakGateVerdict, requireKeycloak } from "./keycloak-gate";

/**
 * `F3.78` U3 (ADR 0089, plan D6, owner ruling Q-A) — the Keycloak
 * integration-test gate, the `KEYCLOAK_ADMIN_URL` twin of
 * `integration-storage-gate.spec.ts`.
 *
 * The thing under test is a guard, and a broken guard fails green: if the CI
 * branch stops refusing, `identity-admin.client.integration` vanishes from CI
 * while its file still reports as passing. Locally that suite always skips, so
 * nothing but this file exercises the CI throw or the misconfiguration throw.
 *
 * Every function restores `process.env` exactly. One claim per function.
 */

const KEYS = [
  "KEYCLOAK_ADMIN_URL",
  "KEYCLOAK_ADMIN_REALM",
  "KEYCLOAK_ADMIN_CLIENT_ID",
  "KEYCLOAK_ADMIN_CLIENT_SECRET",
  "KEYCLOAK_INTEGRATION",
  "CI",
] as const;

type GateEnv = Partial<Record<(typeof KEYS)[number], string>>;

const SECRET = "gate-secret-61a0f2";

const COMPLETE: GateEnv = {
  KEYCLOAK_ADMIN_URL: "http://keycloak:8080",
  KEYCLOAK_ADMIN_REALM: "bms",
  KEYCLOAK_ADMIN_CLIENT_ID: "bms-api-admin",
  KEYCLOAK_ADMIN_CLIENT_SECRET: SECRET,
};

const MISCONFIGURED: GateEnv = { ...COMPLETE, KEYCLOAK_ADMIN_URL: "http://localhost:8080" };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function withEnv<T>(env: GateEnv, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of KEYS) {
      const value = saved.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

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

const probe = () =>
  requireKeycloak({
    item: "F3.78",
    label: "Keycloak integration spec",
    because: "SENTINEL-REASON-k7",
  });

const messageOf = (err: unknown) => String((err as { message?: unknown })?.message ?? err);

// --- the pure verdict --------------------------------------------------------

export function assertAnUnsetUrlSkipsLocally(): void {
  const verdict = keycloakGateVerdict({});
  assert(verdict.kind === "skip", `no URL and not CI must skip; got ${verdict.kind}`);
}

export function assertAnUnsetUrlRefusesInCi(): void {
  const verdict = keycloakGateVerdict({ CI: "true" });
  assert(verdict.kind === "refuse-unset", `no URL in CI must refuse; got ${verdict.kind}`);
}

export function assertABlankUrlCountsAsUnset(): void {
  const verdict = keycloakGateVerdict({ KEYCLOAK_ADMIN_URL: "  ", CI: "1" });
  assert(verdict.kind === "refuse-unset", `a blank URL in CI must refuse as unset; got ${verdict.kind}`);
}

export function assertACompleteConfigRuns(): void {
  const verdict = keycloakGateVerdict(COMPLETE);
  assert(
    verdict.kind === "run" && verdict.config.url === "http://keycloak:8080",
    `a complete configuration must run with the built config; got ${verdict.kind}`,
  );
}

/** A set URL is a claim that Keycloak exists: a misconfiguration is never a skip. */
export function assertAMisconfiguredUrlRefusesLocally(): void {
  const verdict = keycloakGateVerdict(MISCONFIGURED);
  assert(
    verdict.kind === "refuse-misconfigured",
    `a set URL the config refuses must refuse locally too; got ${verdict.kind}`,
  );
}

export function assertAMissingSecretBesideASetUrlRefuses(): void {
  const verdict = keycloakGateVerdict({ ...COMPLETE, KEYCLOAK_ADMIN_CLIENT_SECRET: undefined });
  assert(
    verdict.kind === "refuse-misconfigured",
    `a set URL with no secret must refuse, not skip; got ${verdict.kind}`,
  );
}

export function assertADeclaredSkipIsHonouredInCi(): void {
  const verdict = keycloakGateVerdict({ KEYCLOAK_INTEGRATION: "skip", CI: "true" });
  assert(
    verdict.kind === "declared-skip",
    `KEYCLOAK_INTEGRATION=skip in CI must be a declared skip, not a refusal; got ${verdict.kind}`,
  );
}

/** Precedence, pinned: a declared skip does not launder a misconfigured URL. */
export function assertADeclaredSkipDoesNotHideAMisconfiguration(): void {
  const verdict = keycloakGateVerdict({ ...MISCONFIGURED, KEYCLOAK_INTEGRATION: "skip" });
  assert(
    verdict.kind === "refuse-misconfigured",
    `a misconfigured URL must refuse even with KEYCLOAK_INTEGRATION=skip; got ${verdict.kind}`,
  );
}

export function assertOnlyTheExactSkipValueDeclaresASkip(): void {
  const kinds = ["SKIP", "1", "true", " skip"].map(
    (value) => keycloakGateVerdict({ KEYCLOAK_INTEGRATION: value, CI: "true" }).kind,
  );
  assert(
    kinds.every((k) => k === "refuse-unset"),
    `only the exact string "skip" may declare a skip; got ${JSON.stringify(kinds)}`,
  );
}

export function assertCiIsDetectedByValueNotTruthiness(): void {
  const kinds = ["false", "0", "", "yes", "TRUE"].map((value) => keycloakGateVerdict({ CI: value }).kind);
  assert(
    kinds.every((k) => k === "skip"),
    `only CI="true" or "1" is CI; got ${JSON.stringify(kinds)}`,
  );
}

// --- the effects -------------------------------------------------------------

/** Plan D6: exactly this line, on stderr (Vitest drops `console` from a skipped file). */
export function assertTheLocalSkipWritesTheOneLine(): void {
  const { result, written } = withEnv({}, () => capturingStderr(probe));
  assert(
    result === undefined &&
      written === "F3.78: Keycloak integration spec skipped — KEYCLOAK_ADMIN_URL unset\n",
    `the local skip must return undefined and write the one D6 line; got ${JSON.stringify(written)}`,
  );
}

export function assertTheCiRefusalThrowsWithTheCallersReason(): void {
  const thrown = withEnv({ CI: "true" }, () => captureThrow(probe));
  const message = messageOf(thrown);
  assert(
    message.includes("SENTINEL-REASON-k7") &&
      message.includes("F3.78") &&
      message.includes("KEYCLOAK_ADMIN_URL"),
    `the CI refusal must throw naming the item, the variable and the caller's reason; got ${message}`,
  );
}

export function assertAMisconfigurationThrowsLocally(): void {
  const { result: thrown, written } = withEnv(MISCONFIGURED, () =>
    capturingStderr(() => captureThrow(probe)),
  );
  assert(
    messageOf(thrown).includes("KEYCLOAK_ADMIN_URL") && written === "",
    `a misconfigured URL must throw locally and print no skip line; got ${messageOf(thrown)} / ${JSON.stringify(written)}`,
  );
}

/** §9.6: names, never values. */
export function assertTheMisconfigurationMessageCarriesNoValue(): void {
  const thrown = withEnv(MISCONFIGURED, () => captureThrow(probe));
  const message = messageOf(thrown);
  assert(
    message.includes("KEYCLOAK_ADMIN_URL") &&
      !message.includes("localhost") &&
      !message.includes(SECRET),
    `the refusal must carry neither the URL value nor the secret; got ${message}`,
  );
}

export function assertADeclaredSkipWritesAVerdictLine(): void {
  const { result, written } = withEnv({ KEYCLOAK_INTEGRATION: "skip", CI: "true" }, () =>
    capturingStderr(probe),
  );
  assert(
    result === undefined && written.includes("F3.78") && written.includes("KEYCLOAK_INTEGRATION=skip"),
    `a declared skip must return undefined and say so on stderr; got ${JSON.stringify(written)}`,
  );
}

export function assertACompleteConfigIsReturned(): void {
  const { result, written } = withEnv(COMPLETE, () => capturingStderr(probe));
  assert(
    result?.clientSecret === SECRET && written === "",
    `a complete configuration must be returned silently; got ${JSON.stringify(result?.url)} / ${JSON.stringify(written)}`,
  );
}
