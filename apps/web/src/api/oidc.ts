import type { UserRole } from "@bms/shared";

import type { AuthUser } from "../stores/auth-store";

const verifierKey = "bms-oidc-code-verifier";
const stateKey = "bms-oidc-state";

type TokenResponse = {
  access_token: string;
  expires_in?: number;
};

type KeycloakClaims = {
  sub?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  realm_access?: {
    roles?: unknown;
  };
};

export type OidcSession = {
  accessToken: string;
  expiresIn: string;
  user: AuthUser;
};

function oidcIssuer(): string {
  return import.meta.env.VITE_OIDC_ISSUER ?? "";
}

function clientId(): string {
  return import.meta.env.VITE_OIDC_CLIENT_ID ?? "";
}

function redirectUri(): string {
  return (
    import.meta.env.VITE_OIDC_REDIRECT_URI ??
    `${window.location.origin}/auth/callback`
  );
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

function decodeJwtPayload(token: string): KeycloakClaims {
  const [, payload] = token.split(".");
  if (!payload) {
    throw new Error("OIDC access token is missing claims");
  }

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(normalized)) as KeycloakClaims;
}

function roleFromClaims(claims: KeycloakClaims): UserRole {
  const roles = claims.realm_access?.roles;
  if (!Array.isArray(roles)) {
    return "viewer";
  }
  if (roles.includes("admin")) {
    return "admin";
  }
  if (roles.includes("operator")) {
    return "operator";
  }
  return "viewer";
}

/** Returns true when the SPA should use Keycloak/OIDC instead of local login. */
export function isOidcEnabled(): boolean {
  return (
    import.meta.env.VITE_AUTH_MODE === "oidc" &&
    oidcIssuer().length > 0 &&
    clientId().length > 0
  );
}

/** Starts OIDC Authorization Code + PKCE login in the browser. */
export async function startOidcLogin(): Promise<void> {
  const verifier = randomBase64Url(64);
  const state = randomBase64Url(32);
  const challenge = await sha256Base64Url(verifier);

  sessionStorage.setItem(verifierKey, verifier);
  sessionStorage.setItem(stateKey, state);

  const url = new URL(`${oidcIssuer()}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  window.location.assign(url.toString());
}

/** Completes OIDC callback handling and returns the app session. */
export async function completeOidcLogin(search: string): Promise<OidcSession> {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error) {
    throw new Error(params.get("error_description") ?? error);
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = sessionStorage.getItem(stateKey);
  const verifier = sessionStorage.getItem(verifierKey);
  sessionStorage.removeItem(stateKey);
  sessionStorage.removeItem(verifierKey);

  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    throw new Error("OIDC callback state is invalid");
  }

  const body = new URLSearchParams({
    client_id: clientId(),
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });

  const res = await fetch(`${oidcIssuer()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`OIDC token exchange failed (${res.status})`);
  }

  const token = (await res.json()) as TokenResponse;
  const claims = decodeJwtPayload(token.access_token);
  const id = claims.sub;
  if (!id) {
    throw new Error("OIDC access token is missing subject");
  }

  const email = claims.email ?? claims.preferred_username ?? id;
  return {
    accessToken: token.access_token,
    expiresIn: `${token.expires_in ?? 0}s`,
    user: {
      id,
      email,
      displayName: claims.name ?? email,
      role: roleFromClaims(claims),
    },
  };
}
