import { UnauthorizedException } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";

import type { BmsDb } from "@bms/db";

import { AuthService } from "./auth.service";
import { isLocalLoginEnabled, resolveAuthMode } from "./auth-mode";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DB_REACHED = "AUTH_SPEC_DB_REACHED";

/** Marker error proving the login gate let the request through to the DB. */
class DatabaseReachedError extends Error {
  constructor() {
    super(DB_REACHED);
  }
}

function buildAuthService(): AuthService {
  const db = {
    select() {
      throw new DatabaseReachedError();
    },
  } as unknown as BmsDb;
  const jwt = {
    signAsync: () => Promise.resolve("spec.jwt.token"),
  } as unknown as JwtService;
  return new AuthService(db, jwt);
}

const CREDENTIALS = {
  email: "admin@bms.local",
  password: "spec-only-not-a-real-secret",
};

/** Runs `login` and returns the thrown error (or null when it resolved). */
async function loginError(): Promise<unknown> {
  try {
    await buildAuthService().login(CREDENTIALS);
    return null;
  } catch (err) {
    return err;
  }
}

/**
 * F4.12 — the local JWT/password path must be off whenever the API is
 * configured for OIDC.
 *
 * Before the fix `AuthService.login` gated only on `AUTH_MODE === "oidc"`,
 * while `JwtAuthGuard` already treated a configured `OIDC_ISSUER` as OIDC. An
 * environment that set only `OIDC_ISSUER` therefore kept a live password login
 * endpoint next to Keycloak. Both now share `resolveAuthMode`.
 */
export async function runAuthModeTests(): Promise<void> {
  // --- Pure resolution. ---
  assert(resolveAuthMode({}) === "local", "no config means local auth");
  assert(
    resolveAuthMode({ AUTH_MODE: "local" }) === "local",
    "AUTH_MODE=local without an issuer means local auth",
  );
  assert(
    resolveAuthMode({ OIDC_ISSUER: "" }) === "local",
    "a blank issuer is not configuration",
  );
  assert(
    resolveAuthMode({ OIDC_ISSUER: "   " }) === "local",
    "a whitespace-only issuer is not configuration",
  );
  assert(
    resolveAuthMode({ AUTH_MODE: "oidc" }) === "oidc",
    "AUTH_MODE=oidc selects OIDC",
  );
  assert(
    resolveAuthMode({ AUTH_MODE: "OIDC" }) === "oidc",
    "AUTH_MODE is matched case-insensitively",
  );
  assert(
    resolveAuthMode({ OIDC_ISSUER: "https://keycloak.local/realms/bms" }) ===
      "oidc",
    "a configured issuer alone selects OIDC",
  );
  assert(
    resolveAuthMode({
      AUTH_MODE: "local",
      OIDC_ISSUER: "https://keycloak.local/realms/bms",
    }) === "oidc",
    "AUTH_MODE=local must not re-open local login when an issuer is set",
  );
  assert(
    !isLocalLoginEnabled({ OIDC_ISSUER: "https://keycloak.local/realms/bms" }),
    "local login is disabled once an issuer is configured",
  );
  assert(isLocalLoginEnabled({}), "local login stays enabled for native dev");

  // --- Behaviour of the login endpoint itself. ---
  const originalAuthMode = process.env.AUTH_MODE;
  const originalIssuer = process.env.OIDC_ISSUER;
  try {
    // The bypass: issuer configured, AUTH_MODE never set.
    delete process.env.AUTH_MODE;
    process.env.OIDC_ISSUER = "https://keycloak.local/realms/bms";
    const issuerOnly = await loginError();
    assert(
      issuerOnly instanceof UnauthorizedException,
      "OIDC_ISSUER alone must reject local password login",
    );
    assert(
      !(issuerOnly instanceof DatabaseReachedError),
      "login must be refused before any credential lookup",
    );
    const message = (issuerOnly as UnauthorizedException).message;
    assert(message.length > 0, "the rejection must carry a clear reason");
    assert(
      !message.includes(CREDENTIALS.password),
      "the rejection must never echo the submitted password",
    );

    // AUTH_MODE=local must not override a configured issuer.
    process.env.AUTH_MODE = "local";
    assert(
      (await loginError()) instanceof UnauthorizedException,
      "AUTH_MODE=local must not re-enable login when an issuer is set",
    );

    // Pre-existing behaviour: explicit OIDC mode without an issuer.
    process.env.AUTH_MODE = "oidc";
    delete process.env.OIDC_ISSUER;
    assert(
      (await loginError()) instanceof UnauthorizedException,
      "AUTH_MODE=oidc still rejects local login",
    );

    // Local development must be untouched: the gate lets the request reach the
    // credential lookup, which the stub DB reports.
    delete process.env.AUTH_MODE;
    delete process.env.OIDC_ISSUER;
    const localDev = await loginError();
    assert(
      localDev instanceof DatabaseReachedError,
      "local dev login must still reach the credential lookup",
    );
  } finally {
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
    } else {
      process.env.AUTH_MODE = originalAuthMode;
    }
    if (originalIssuer === undefined) {
      delete process.env.OIDC_ISSUER;
    } else {
      process.env.OIDC_ISSUER = originalIssuer;
    }
  }
}
