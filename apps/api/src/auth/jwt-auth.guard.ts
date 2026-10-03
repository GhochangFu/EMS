import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createPublicKey } from "node:crypto";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";

import { AUTH_DRIZZLE } from "../database/database.tokens";
import { type AuthMode, resolveAuthMode } from "./auth-mode";
import { linkIdentity, rememberIdentity, resolveIdentity } from "./identity-resolver";

type RequestWithUser = {
  headers: { authorization?: string };
  user?: JwtPayload;
};

type JwtHeader = {
  kid?: string;
};

type KeycloakClaims = {
  sub: string;
  email?: string;
  email_verified?: unknown;
  /** The client the token was issued to — ADR 0089 decision 5 accepts only `OIDC_CLIENT_ID`. */
  azp?: string;
  preferred_username?: string;
  name?: string;
  realm_access?: {
    roles?: unknown;
  };
};

type RsaJwk = {
  kty: "RSA";
  kid?: string;
  n: string;
  e: string;
};

let jwksCache: RsaJwk[] | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeJwtSegment<T>(segment: string): T {
  const decoded = Buffer.from(segment, "base64url").toString("utf8");
  return JSON.parse(decoded) as T;
}

function authMode(): AuthMode {
  return resolveAuthMode(process.env);
}

async function fetchJwks(): Promise<RsaJwk[]> {
  if (jwksCache) {
    return jwksCache;
  }

  const issuer = process.env.OIDC_ISSUER;
  const uri =
    process.env.OIDC_JWKS_URI ??
    (issuer ? `${issuer}/protocol/openid-connect/certs` : undefined);
  if (!uri) {
    throw new UnauthorizedException("OIDC JWKS URI is not configured");
  }

  const res = await fetch(uri);
  if (!res.ok) {
    throw new UnauthorizedException("OIDC JWKS fetch failed");
  }

  const body = (await res.json()) as unknown;
  if (!isRecord(body) || !Array.isArray(body.keys)) {
    throw new UnauthorizedException("OIDC JWKS response is invalid");
  }

  jwksCache = body.keys.filter(
    (key): key is RsaJwk =>
      isRecord(key) &&
      key.kty === "RSA" &&
      typeof key.n === "string" &&
      typeof key.e === "string" &&
      (key.kid === undefined || typeof key.kid === "string"),
  );
  return jwksCache;
}

function roleFromClaims(claims: KeycloakClaims): UserRole {
  const roles = claims.realm_access?.roles;
  if (!Array.isArray(roles)) {
    return "viewer";
  }

  if (roles.includes("admin")) {
    return "admin";
  }
  if (roles.includes("organization_admin")) {
    return "organization_admin";
  }
  if (roles.includes("location_admin")) {
    return "location_admin";
  }
  if (roles.includes("asset_group_admin")) {
    return "asset_group_admin";
  }
  if (roles.includes("operator")) {
    return "operator";
  }
  return "viewer";
}

/**
 * `F3.78` / ADR 0089 — the guard verifies the token **and** resolves the
 * `bms.users` row it names (`identity-resolver.ts`), on the auth pool.
 *
 * - **Decision 5:** an OIDC token must carry `azp === OIDC_CLIENT_ID`. A
 *   `bms-api-admin` client-credentials token is signed by the same realm and
 *   passes the issuer check; without this it would be a bearer token here.
 *   An unset `OIDC_CLIENT_ID` refuses every token, as an unset `OIDC_ISSUER`
 *   does.
 * - **Decision 4:** the row is matched by subject (OIDC) or id (local). A
 *   verified email with no row linked yet is linked once (`linkIdentity`).
 *   No row leaves the identity `null`, and the request takes the ADR 0044
 *   path in `AccessControlService`.
 * - **Decision 8:** a row with `disabled_at` set is a 401 — after the
 *   signature check, so a forged token never reaches the database.
 *
 * The resolved row is memoised on the request's payload object, so
 * `AccessControlService` and the audit actor lookups read it without a
 * second query. **The `AUTH_DRIZZLE` injection is a DI change** that no spec
 * here can prove (vitest emits no `design:paramtypes`); the boot check is
 * step 6: `api` and `api-replica` log "Nest application successfully started".
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(AUTH_DRIZZLE) private readonly authDb: BmsDb,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = header.slice(7);

    req.user = await this.verifyToken(token);
    return true;
  }

  /** Verifies either a local JWT or OIDC token using the active auth mode. */
  async verifyToken(token: string): Promise<JwtPayload> {
    const oidc = authMode() === "oidc";
    const payload = oidc ? await this.verifyOidcToken(token) : this.verifyLocalToken(token);

    const identity =
      (await resolveIdentity(this.authDb, payload)) ??
      (oidc && payload.emailVerified === true ? await linkIdentity(this.authDb, payload) : null);
    if (identity?.disabledAt) {
      throw new UnauthorizedException("This account is deactivated");
    }
    if (identity) {
      rememberIdentity(payload, identity);
    }
    return payload;
  }

  private verifyLocalToken(token: string): JwtPayload {
    try {
      return this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }

  private async verifyOidcToken(token: string): Promise<JwtPayload> {
    const issuer = process.env.OIDC_ISSUER;
    if (!issuer) {
      throw new UnauthorizedException("OIDC issuer is not configured");
    }
    const clientId = process.env.OIDC_CLIENT_ID;
    if (!clientId) {
      throw new UnauthorizedException("OIDC client id is not configured");
    }

    try {
      const [headerSegment] = token.split(".");
      if (!headerSegment) {
        throw new UnauthorizedException("Invalid token");
      }
      const header = decodeJwtSegment<JwtHeader>(headerSegment);
      const keys = await fetchJwks();
      const key = keys.find((candidate) => candidate.kid === header.kid) ?? keys[0];
      if (!key) {
        throw new UnauthorizedException("OIDC signing key is not available");
      }

      const publicKey = createPublicKey({ key, format: "jwk" }).export({
        format: "pem",
        type: "spki",
      });

      const claims = this.jwt.verify<KeycloakClaims>(token, {
        algorithms: ["RS256"],
        audience: process.env.OIDC_AUDIENCE || undefined,
        issuer,
        secret: publicKey,
      });

      if (claims.azp !== clientId) {
        throw new UnauthorizedException("Token was not issued to this application");
      }

      const email = claims.email ?? claims.preferred_username ?? claims.sub;
      return {
        sub: claims.sub,
        email,
        name: claims.name ?? email,
        role: roleFromClaims(claims),
        // Both conjuncts: a token with `email_verified: true` and no `email`
        // falls back to `preferred_username` above, and linking by that would
        // let a username that looks like an email claim the row.
        emailVerified: claims.email_verified === true && typeof claims.email === "string",
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      jwksCache = null;
      throw new UnauthorizedException("Invalid token");
    }
  }
}
