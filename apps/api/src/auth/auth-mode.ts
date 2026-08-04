/** How the API authenticates callers for this process. */
export type AuthMode = "local" | "oidc";

/** Environment slice that decides the auth mode. */
export type AuthModeEnv = {
  AUTH_MODE?: string | undefined;
  OIDC_ISSUER?: string | undefined;
};

/**
 * Resolves the active auth mode (ADR 0003).
 *
 * A configured `OIDC_ISSUER` is on its own sufficient to select OIDC: an
 * environment pointed at Keycloak must never also accept local passwords just
 * because `AUTH_MODE` was left unset or set to `local`. Only a completely
 * absent/blank issuer *and* a non-`oidc` `AUTH_MODE` leaves local login on,
 * which is the native-WSL development path.
 */
export function resolveAuthMode(env: AuthModeEnv): AuthMode {
  if (env.AUTH_MODE?.trim().toLowerCase() === "oidc") {
    return "oidc";
  }
  if ((env.OIDC_ISSUER ?? "").trim() !== "") {
    return "oidc";
  }
  return "local";
}

/** Whether the local email/password login path may issue tokens. */
export function isLocalLoginEnabled(env: AuthModeEnv): boolean {
  return resolveAuthMode(env) === "local";
}
