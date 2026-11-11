import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { createPublicKey } from "node:crypto";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, UnauthorizedEnvelope, UserRole } from "@bms/shared";

import { AUTH_DRIZZLE } from "../database/database.tokens";
import { type AuthMode, resolveAuthMode } from "./auth-mode";
import { RATE_LIMIT_CLASS_METADATA, rateLimitClassFor } from "../rate-limit/rate-limit-class.decorator";
import type { RateLimitClass } from "../rate-limit/rate-limit-config";
import { RateLimiterService } from "../rate-limit/rate-limiter.service";
import { looksLikeServiceToken } from "../service-accounts/service-token-codec";
import { ServiceTokenVerifier } from "../service-accounts/service-token-verifier.service";
import { rateLimitedException, rateLimitedHeaders } from "../rate-limit/rate-limited.exception";
import { linkIdentity, recalledIdentity, rememberIdentity, resolveIdentity } from "./identity-resolver";

type RequestWithUser = {
  method?: string;
  headers: { authorization?: string };
  user?: JwtPayload;
};

type ResponseWithHeaders = {
  setHeader(name: string, value: string): unknown;
};

const reflector = new Reflector();

/**
 * `F4.17` / ADR 0125 decisions 11 and 12 — what a `bms_sat_` token adds to its
 * principal, kept beside the payload object (the identity memo's pattern) so
 * the guard, the gateways and the limiter read it without a second lookup.
 */
type ServiceTokenFacts = Readonly<{ tokenId: string; readOnly: boolean; expiresAt: number }>;
const serviceTokens = new WeakMap<object, ServiceTokenFacts>();

/** The token facts of a principal that authenticated with a `bms_sat_` token, or `null` for a JWT. */
export function serviceTokenOf(payload: object): ServiceTokenFacts | null {
  return serviceTokens.get(payload) ?? null;
}

/** The one 401 every refused service token gets: unknown, malformed, revoked, expired or disabled. */
function invalidServiceToken(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    message: "Invalid token",
    error: "Unauthorized",
    code: "token_invalid",
  } satisfies UnauthorizedEnvelope);
}

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
    @Optional() private readonly rateLimiter?: RateLimiterService,
    // `F4.17` / ADR 0125 decision 11. Optional so a spec builds the guard by
    // hand; without it a `bms_sat_` token is refused, never accepted.
    @Optional() private readonly serviceTokenVerifier?: ServiceTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = header.slice(7);

    req.user = await this.verifyToken(token);
    // A read-only token's write is refused by `ReadOnlyServiceTokenInterceptor`
    // (403), not here: this guard answers 401 and never 403 (`F4.52`).
    await this.enforceIdentityLimit(context, req, req.user);
    return true;
  }


  /**
   * `F4.17` / ADR 0125 decisions 1, 2 and 5 — **Stage 2**, per identity, at
   * the end of the guard (Q3). One site covers every guarded controller, and
   * because a guard runs before any interceptor it refuses an upload before
   * the controller's `FileInterceptor` buffers it.
   *
   * The subject is the resolved `bms.users.id`; a principal with no row (the
   * ADR 0044 path) counts as `sub:<subject>`. A request that fails
   * authentication never reaches this line, so a 401 spends no budget.
   *
   * No limiter (a spec or module that does not import `RateLimitModule`)
   * means no Stage 2 check; `AppModule` imports it, and
   * `tests/f4.17-rate-limit-wiring.test.ts` pins that it does.
   */
  private async enforceIdentityLimit(
    context: ExecutionContext,
    req: RequestWithUser,
    payload: JwtPayload,
  ): Promise<void> {
    const limiter = this.rateLimiter;
    if (!limiter || limiter.mode === "off") {
      return;
    }
    const explicit = reflector.getAllAndOverride<RateLimitClass | undefined>(
      RATE_LIMIT_CLASS_METADATA,
      [context.getHandler(), context.getClass()],
    );
    // A service token is its own budget (decision 1): one leaked token cannot
    // drain the account's other token.
    const facts = serviceTokenOf(payload);
    const subject = facts ? `token:${facts.tokenId}` : (recalledIdentity(payload)?.id ?? `sub:${payload.sub}`);
    const decision = await limiter.checkIdentity(rateLimitClassFor(req.method, explicit), subject);
    if (decision.refuse) {
      const res = context.switchToHttp().getResponse<ResponseWithHeaders>();
      for (const [name, value] of Object.entries(rateLimitedHeaders(decision.refusal))) {
        res.setHeader(name, value);
      }
      throw rateLimitedException(decision.refusal);
    }
  }

  /**
   * Verifies a service-account token, a local JWT or an OIDC token. The
   * `bms_sat_` prefix routes before any JWT parse, so a token never reaches
   * the JWT path and a JWT never reaches the token path — under either
   * `AUTH_MODE` (decision 11).
   */
  async verifyToken(token: string): Promise<JwtPayload> {
    if (looksLikeServiceToken(token)) {
      return this.verifyServiceToken(token);
    }
    const oidc = authMode() === "oidc";
    const payload = oidc ? await this.verifyOidcToken(token) : this.verifyLocalToken(token);

    const identity =
      (await resolveIdentity(this.authDb, payload)) ??
      (oidc && payload.emailVerified === true ? await linkIdentity(this.authDb, payload) : null);
    if (identity?.disabledAt) {
      // `F4.203` — the body carries a machine code, so the web can say why the
      // session ended instead of returning to sign-in in silence.
      throw new UnauthorizedException({
        statusCode: 401,
        message: "This account is deactivated",
        error: "Unauthorized",
        code: "account_deactivated",
      } satisfies UnauthorizedEnvelope);
    }
    if (identity?.kind === "service") {
      // F4.17 / ADR 0125 decision 10 — a service row is reached only through
      // a `bms_sat_` token (PR 4), never through a JWT: no login issues one
      // for it, so a JWT naming it is forged or mis-issued.
      throw new UnauthorizedException("Invalid token");
    }
    if (identity) {
      rememberIdentity(payload, identity);
    }
    return payload;
  }

  private async verifyServiceToken(token: string): Promise<JwtPayload> {
    const principal = await this.serviceTokenVerifier?.verify(token);
    if (!principal) {
      throw invalidServiceToken();
    }
    // The identity memo the rest of the request reads (`resolveDbUser`,
    // `resolveActorId`): a service row has no OIDC subject to resolve by.
    rememberIdentity(principal.payload, principal.identity);
    serviceTokens.set(principal.payload, {
      tokenId: principal.tokenId,
      readOnly: principal.readOnly,
      expiresAt: principal.expiresAt,
    });
    return principal.payload;
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
