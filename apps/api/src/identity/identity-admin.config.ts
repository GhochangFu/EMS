import { Logger } from "@nestjs/common";

/**
 * `F3.78` (ADR 0089 decision 5) — the Keycloak admin client's configuration,
 * read from the environment in one place, like `notifications.config.ts`.
 *
 * `buildIdentityAdminConfig` is a pure function of an environment object and a
 * warn sink, so a spec enumerates the cases without touching `process.env`.
 *
 * **`null` means user administration is not configured.** The user write
 * routes then answer 503 and the reads keep working (decision 5); there is no
 * default for any of the four variables, because a partial configuration is
 * not a configuration.
 *
 * **The URL rule.** `https://` is required, with exactly one exception: the
 * Compose service name `http://keycloak:8080`, where the traffic never leaves
 * the Compose network. The exception is a parsed match — protocol, hostname,
 * port, no userinfo — never a string prefix: `http://keycloak:8080.evil.example`
 * and `http://keycloak:8080@evil.example` both start with the exempt text. The
 * client secret is equivalent to global admin, so it must never cross a
 * network in the clear. CI and a from-source developer reach the rule through
 * a `keycloak` hosts entry, not by widening it (plan D6, ruling Q-B).
 *
 * **What is warned.** One line per refusal, naming the variable and never its
 * value (§9.6): a URL can carry credentials in its userinfo, and the secret
 * sits beside it in the same environment.
 */

/**
 * How long one Keycloak admin request (the token request included) may take
 * before it fails as `unavailable`. An admin role change calls
 * `setRealmRole` while it holds the active-admin row locks, so an unbounded
 * wait there would hold them for as long as Keycloak hangs.
 */
export const KEYCLOAK_REQUEST_TIMEOUT_MS = 10_000;

export type IdentityAdminConfig = {
  /** Base URL with no trailing slash, e.g. `http://keycloak:8080`. */
  readonly url: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

const VARIABLES = [
  "KEYCLOAK_ADMIN_URL",
  "KEYCLOAK_ADMIN_REALM",
  "KEYCLOAK_ADMIN_CLIENT_ID",
  "KEYCLOAK_ADMIN_CLIENT_SECRET",
] as const;

const logger = new Logger("IdentityAdminConfig");

/** A blank value is unset: Compose's `${VAR:-}` passes `""`, not nothing. */
function read(env: NodeJS.ProcessEnv, name: (typeof VARIABLES)[number]): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * The base URL when it satisfies the rule, otherwise `null`. Never throws: a
 * malformed value is a refusal like any other.
 */
function acceptedBaseUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    return null;
  }
  const isHttps = parsed.protocol === "https:" && parsed.hostname !== "";
  const isComposeName =
    parsed.protocol === "http:" &&
    parsed.hostname === "keycloak" &&
    parsed.port === "8080" &&
    (parsed.pathname === "/" || parsed.pathname === "");
  if (!isHttps && !isComposeName) {
    return null;
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

export function buildIdentityAdminConfig(
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void = (message) => logger.warn(message),
): IdentityAdminConfig | null {
  for (const name of VARIABLES) {
    if (read(env, name) === undefined) {
      warn(`User administration is not configured: ${name} is unset.`);
      return null;
    }
  }

  const url = acceptedBaseUrl(read(env, "KEYCLOAK_ADMIN_URL")!);
  if (url === null) {
    warn(
      "User administration is not configured: KEYCLOAK_ADMIN_URL must be an https:// URL " +
        "(the one exception is http://keycloak:8080, the Compose service name).",
    );
    return null;
  }

  return {
    url,
    realm: read(env, "KEYCLOAK_ADMIN_REALM")!,
    clientId: read(env, "KEYCLOAK_ADMIN_CLIENT_ID")!,
    clientSecret: read(env, "KEYCLOAK_ADMIN_CLIENT_SECRET")!,
  };
}
