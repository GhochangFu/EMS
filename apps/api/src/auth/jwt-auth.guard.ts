import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createPublicKey } from "node:crypto";

import type { JwtPayload, UserRole } from "@bms/shared";

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

function authMode(): "local" | "oidc" {
  return process.env.AUTH_MODE === "oidc" || process.env.OIDC_ISSUER
    ? "oidc"
    : "local";
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

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

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
    return authMode() === "oidc"
      ? await this.verifyOidcToken(token)
      : this.verifyLocalToken(token);
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

      const email = claims.email ?? claims.preferred_username ?? claims.sub;
      return {
        sub: claims.sub,
        email,
        name: claims.name ?? email,
        role: roleFromClaims(claims),
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
