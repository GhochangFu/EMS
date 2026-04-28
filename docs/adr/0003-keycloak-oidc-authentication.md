# ADR 0003: Keycloak / OIDC Authentication

## Status

Accepted for Phase 1 Sprint C.

## Context

The prototype used a local `bms.users` password table and API-signed JWTs.
That was enough for a seven-screen demo, but a pilot needs an external
identity provider so browser login and API bearer-token validation match a
real deployment model.

## Decision

Use Keycloak as the local/pilot OIDC provider. The web app will use
Authorization Code + PKCE when OIDC environment variables are enabled. The
API will validate Keycloak-issued bearer tokens against the realm JWKS and
map Keycloak realm roles to the existing prototype role slugs:

- `admin`
- `operator`
- `viewer`

Native WSL development may continue to use the local JWT login path while
the team transitions workflows. Compose/pilot runs should use Keycloak.

## Consequences

- A committed Keycloak realm export is required for reproducible local and
  pilot startup.
- New OIDC environment variables must be documented for API and web.
- The existing local auth code remains as a development fallback only and
  should be retired once Sprint C is accepted.
