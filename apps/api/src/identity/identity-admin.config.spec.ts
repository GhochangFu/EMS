import { buildIdentityAdminConfig, type IdentityAdminConfig } from "./identity-admin.config";

/**
 * `F3.78` U3 (ADR 0089 decision 5) — the Keycloak admin client's configuration.
 *
 * Assertions live here; `identity-admin.config.test.ts` runs them (ADR 0014).
 * `buildIdentityAdminConfig` takes an environment object and a warn sink, so no
 * case mutates `process.env` and every case can read what was warned.
 *
 * One claim per exported function: an `assert` throws, so a second claim in
 * the same function would never be reached once the first reddens.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SECRET = "probe-secret-7f3c91";

/** A complete, valid environment. Each case removes or changes one variable. */
function completeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    KEYCLOAK_ADMIN_URL: "http://keycloak:8080",
    KEYCLOAK_ADMIN_REALM: "bms",
    KEYCLOAK_ADMIN_CLIENT_ID: "bms-api-admin",
    KEYCLOAK_ADMIN_CLIENT_SECRET: SECRET,
    ...overrides,
  };
}

function build(env: NodeJS.ProcessEnv): { config: IdentityAdminConfig | null; warned: string[] } {
  const warned: string[] = [];
  const config = buildIdentityAdminConfig(env, (message) => warned.push(message));
  return { config, warned };
}

export function assertNullWhenTheSecretIsUnset(): void {
  const { config } = build(completeEnv({ KEYCLOAK_ADMIN_CLIENT_SECRET: undefined }));
  assert(config === null, "an unset KEYCLOAK_ADMIN_CLIENT_SECRET must yield null (decision 5)");
}

/** U4's compose passes `${KEYCLOAK_ADMIN_CLIENT_SECRET:-}`, which is `""`, not unset. */
export function assertNullWhenTheSecretIsBlank(): void {
  const { config } = build(completeEnv({ KEYCLOAK_ADMIN_CLIENT_SECRET: "   " }));
  assert(config === null, "a blank KEYCLOAK_ADMIN_CLIENT_SECRET must yield null, like an unset one");
}

/** No defaults for the realm or the client id: a partial configuration is not one. */
export function assertNullWhenTheRealmOrClientIdIsUnset(): void {
  const noRealm = build(completeEnv({ KEYCLOAK_ADMIN_REALM: undefined })).config;
  const noClient = build(completeEnv({ KEYCLOAK_ADMIN_CLIENT_ID: "" })).config;
  assert(
    noRealm === null && noClient === null,
    "an unset realm or client id must yield null — there is no default for either",
  );
}

export function assertTheComposeServiceNameIsAccepted(): void {
  const { config } = build(completeEnv());
  assert(
    config !== null && config.url === "http://keycloak:8080",
    `http://keycloak:8080 is the one http exception and must be accepted; got ${JSON.stringify(config?.url)}`,
  );
}

export function assertTheConfigCarriesEveryValue(): void {
  const { config } = build(completeEnv());
  assert(
    config?.realm === "bms" &&
      config.clientId === "bms-api-admin" &&
      config.clientSecret === SECRET,
    "a complete environment must carry the realm, the client id and the secret",
  );
}

export function assertLocalhostIsRefused(): void {
  const { config } = build(completeEnv({ KEYCLOAK_ADMIN_URL: "http://localhost:8080" }));
  assert(config === null, "http://localhost:8080 must be refused — only the compose name is exempt");
}

/** A prefix match would accept both of these; the rule is a parsed host, not a string prefix. */
export function assertALookalikeHostIsRefused(): void {
  const dotted = build(completeEnv({ KEYCLOAK_ADMIN_URL: "http://keycloak:8080.evil.example" }));
  const userinfo = build(completeEnv({ KEYCLOAK_ADMIN_URL: "http://keycloak:8080@evil.example" }));
  assert(
    dotted.config === null && userinfo.config === null,
    "http://keycloak:8080.evil.example and http://keycloak:8080@evil.example must be refused",
  );
}

export function assertHttpsIsAccepted(): void {
  const { config } = build(completeEnv({ KEYCLOAK_ADMIN_URL: "https://id.example" }));
  assert(
    config?.url === "https://id.example",
    `https://id.example must be accepted; got ${JSON.stringify(config?.url)}`,
  );
}

/** A trailing slash would double up in every path the client builds. */
export function assertATrailingSlashIsTrimmed(): void {
  const { config } = build(completeEnv({ KEYCLOAK_ADMIN_URL: "https://id.example/auth/" }));
  assert(
    config?.url === "https://id.example/auth",
    `the base URL must lose its trailing slash; got ${JSON.stringify(config?.url)}`,
  );
}

export function assertTheRefusalWarnsOnceNamingTheVariable(): void {
  const { warned } = build(completeEnv({ KEYCLOAK_ADMIN_URL: "http://localhost:8080" }));
  assert(
    warned.length === 1 && warned[0]!.includes("KEYCLOAK_ADMIN_URL"),
    `a refused URL must warn exactly once, naming KEYCLOAK_ADMIN_URL; got ${JSON.stringify(warned)}`,
  );
}

/** §9.6: the variable's name, never its value — and never the secret beside it. */
export function assertTheWarnCarriesNeitherTheUrlNorTheSecret(): void {
  const { warned } = build(completeEnv({ KEYCLOAK_ADMIN_URL: "http://localhost:8080" }));
  const text = warned.join("\n");
  assert(
    warned.length > 0 && !text.includes("localhost") && !text.includes(SECRET),
    `the warn must carry neither the URL value nor the secret; got ${JSON.stringify(warned)}`,
  );
}

export function assertAnUnsetSecretWarnsByNameOnly(): void {
  const { warned } = build(completeEnv({ KEYCLOAK_ADMIN_CLIENT_SECRET: undefined }));
  const text = warned.join("\n");
  assert(
    warned.length === 1 &&
      text.includes("KEYCLOAK_ADMIN_CLIENT_SECRET") &&
      !text.includes("keycloak:8080"),
    `an unset secret must warn once, by name only; got ${JSON.stringify(warned)}`,
  );
}

export function assertAValidConfigWarnsNothing(): void {
  const { warned } = build(completeEnv());
  assert(warned.length === 0, `a valid configuration must not warn; got ${JSON.stringify(warned)}`);
}
