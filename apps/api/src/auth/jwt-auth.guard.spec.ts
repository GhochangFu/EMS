import { generateKeyPairSync, type JsonWebKey } from "node:crypto";

import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { expect, vi } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "./access-control.service";
import { recalledIdentity, type ResolvedIdentity } from "./identity-resolver";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * `F3.78` / ADR 0089 decisions 4, 5 and 8 — the guard against real RS256
 * tokens. One RSA pair for the whole file (the guard caches the JWKS at module
 * scope, so a second pair would be verified against the first one's key), the
 * JWKS fetch stubbed, the token signed by `JwtService` exactly as Keycloak's
 * would be verified.
 *
 * **Every guard refusal is a 401, so each case asserts the message**: a 401
 * from the wrong check would otherwise pass a case written for another one.
 */

const ISSUER = "https://id.example/realms/bms";
const KID = "f3.78-test-key";
const ID = "00000000-0000-4000-8000-0000000000c1";
const SUB = "kc-subject-c1";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const JWK: JsonWebKey = { ...publicKey.export({ format: "jwk" }), kid: KID };

const jwtService = new JwtService({});

const ROW: ResolvedIdentity = {
  id: ID,
  email: "probe@bms.local",
  displayName: "Probe",
  role: "viewer",
  organizationId: "00000000-0000-4000-8000-0000000000d1",
  oidcSubject: SUB,
  disabledAt: null,
};

type Claims = Record<string, unknown>;

function oidcToken(claims: Claims = {}): string {
  return jwtService.sign(
    {
      sub: SUB,
      azp: "bms-web",
      email: "probe@bms.local",
      email_verified: true,
      name: "Probe",
      realm_access: { roles: ["viewer"] },
      ...claims,
    },
    { algorithm: "RS256", secret: PRIVATE_PEM, keyid: KID, issuer: ISSUER, expiresIn: "5m" },
  );
}

type AuthFake = { db: BmsDb; selects: string[]; updates: number };

const dialect = new PgDialect();

/** The auth pool: each select answers `selectRows`, the link UPDATE answers `updateRows`. */
function authFake(selectRows: ResolvedIdentity[], updateRows: ResolvedIdentity[] = []): AuthFake {
  const fake: AuthFake = { db: undefined as unknown as BmsDb, selects: [], updates: 0 };
  const select = () => {
    const chain = {
      from: () => chain,
      where: (where: SQL) => {
        fake.selects.push(dialect.sqlToQuery(where).sql);
        return chain;
      },
      limit: async () => selectRows,
    };
    return chain;
  };
  const update = () => {
    fake.updates += 1;
    const chain = { set: () => chain, where: () => chain, returning: async () => updateRows };
    return chain;
  };
  fake.db = { select, update } as unknown as BmsDb;
  return fake;
}

/** A fleet pool whose every read is empty: a chain of any length that awaits to `[]`. */
function emptyFleet(): BmsDb {
  const chain: unknown = new Proxy(() => undefined, {
    get: (_target, key) => (key === "then" ? (resolve: (rows: unknown[]) => void) => resolve([]) : () => chain),
    apply: () => chain,
  });
  return chain as BmsDb;
}

const OIDC_ENV: Record<string, string | undefined> = {
  AUTH_MODE: "oidc",
  OIDC_ISSUER: ISSUER,
  OIDC_JWKS_URI: "https://id.example/realms/bms/protocol/openid-connect/certs",
  OIDC_CLIENT_ID: "bms-web",
  OIDC_AUDIENCE: undefined,
};

/** Runs `fn` with `env` applied over the auth variables and the JWKS fetch stubbed, restoring both. */
async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const keys = ["AUTH_MODE", "OIDC_ISSUER", "OIDC_JWKS_URI", "OIDC_CLIENT_ID", "OIDC_AUDIENCE"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ keys: [JWK] }) }));
  try {
    await fn();
  } finally {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const withOidc = (fn: () => Promise<void>) => withEnv(OIDC_ENV, fn);

function guardOver(fake: AuthFake): JwtAuthGuard {
  return new JwtAuthGuard(jwtService, fake.db);
}

export async function assertAcceptsTheWebClient(): Promise<void> {
  await withOidc(async () => {
    const payload = await guardOver(authFake([ROW])).verifyToken(oidcToken());
    expect(payload.sub).toBe(SUB);
  });
}

export async function assertRefusesAnotherClientsToken(): Promise<void> {
  await withOidc(async () => {
    const verify = guardOver(authFake([ROW])).verifyToken(oidcToken({ azp: "bms-api-admin" }));
    await expect(verify).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verify).rejects.toThrow("Token was not issued to this application");
  });
}

export async function assertRefusesAnUnsetClientId(): Promise<void> {
  await withEnv({ ...OIDC_ENV, OIDC_CLIENT_ID: undefined }, async () => {
    const verify = guardOver(authFake([ROW])).verifyToken(oidcToken({ azp: undefined }));
    await expect(verify).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verify).rejects.toThrow("OIDC client id is not configured");
  });
}

export async function assertEmailVerifiedNeedsTheClaimAndAnEmail(): Promise<void> {
  await withOidc(async () => {
    const payload = await guardOver(authFake([ROW])).verifyToken(oidcToken());
    expect(payload.emailVerified).toBe(true);
  });
}

export async function assertEmailVerifiedIsFalseForANonTrueClaim(): Promise<void> {
  await withOidc(async () => {
    const payload = await guardOver(authFake([ROW])).verifyToken(oidcToken({ email_verified: "true" }));
    expect(payload.emailVerified).toBe(false);
  });
}

export async function assertNoEmailClaimNeverLinksByUsername(): Promise<void> {
  await withOidc(async () => {
    const fake = authFake([], [ROW]);
    const payload = await guardOver(fake).verifyToken(
      oidcToken({ email: undefined, preferred_username: "admin@bms.local" }),
    );
    expect(fake.updates).toBe(0);
    expect(recalledIdentity(payload)).toBeNull();
  });
}

export async function assertAVerifiedUnlinkedRowIsLinked(): Promise<void> {
  await withOidc(async () => {
    const fake = authFake([], [ROW]);
    const payload = await guardOver(fake).verifyToken(oidcToken());
    expect(fake.updates).toBe(1);
    expect(recalledIdentity(payload)?.id).toBe(ID);
  });
}

export async function assertNoRowSendsAnAdminClaimTo403(): Promise<void> {
  await withOidc(async () => {
    const fake = authFake([], []);
    const payload = await guardOver(fake).verifyToken(oidcToken({ realm_access: { roles: ["admin"] } }));
    expect(recalledIdentity(payload)).toBeNull();
    const access = new AccessControlService(fake.db, emptyFleet());
    const required = access.requireMasterDataUser(payload);
    await expect(required).rejects.toBeInstanceOf(ForbiddenException);
    await expect(required).rejects.toThrow("matches no provisioned account");
  });
}

export async function assertNoRowGivesAViewerAnEmptyScope(): Promise<void> {
  await withOidc(async () => {
    const fake = authFake([], []);
    const payload = await guardOver(fake).verifyToken(oidcToken());
    expect(recalledIdentity(payload)).toBeNull();
    const access = new AccessControlService(fake.db, emptyFleet());
    expect(await access.readableAssetIds(payload)).toEqual([]);
  });
}

export async function assertARowLinkedElsewhereIsNotRelinked(): Promise<void> {
  await withOidc(async () => {
    // The UPDATE's `oidc_subject IS NULL` matches nothing, and the re-read by
    // this subject finds nothing: identity null, one UPDATE attempted.
    const fake = authFake([], []);
    const payload = await guardOver(fake).verifyToken(oidcToken({ sub: "kc-another-subject" }));
    expect(fake.updates).toBe(1);
    expect(recalledIdentity(payload)).toBeNull();
  });
}

export async function assertADisabledRowIsRefused(): Promise<void> {
  await withOidc(async () => {
    const fake = authFake([{ ...ROW, disabledAt: new Date("2026-10-01T00:00:00Z") }]);
    const verify = guardOver(fake).verifyToken(oidcToken());
    await expect(verify).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(verify).rejects.toThrow("This account is deactivated");
  });
}

/**
 * `F4.203` — the deactivated refusal is a 401 whose body carries the machine
 * code the web reads to say why the session ended.
 */
export async function assertTheDeactivatedRefusalCarriesTheCode(): Promise<void> {
  await withOidc(async () => {
    const fake = authFake([{ ...ROW, disabledAt: new Date("2026-10-01T00:00:00Z") }]);
    const refusal: unknown = await guardOver(fake)
      .verifyToken(oidcToken())
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(refusal).toBeInstanceOf(UnauthorizedException);
    const exception = refusal as UnauthorizedException;
    expect(exception.getStatus()).toBe(401);
    expect((exception.getResponse() as { code?: unknown }).code).toBe("account_deactivated");
  });
}

export async function assertAForgedTokenNeverReachesTheDb(): Promise<void> {
  await withOidc(async () => {
    const fake = authFake([{ ...ROW, disabledAt: new Date("2026-10-01T00:00:00Z") }]);
    const [header, body] = oidcToken().split(".");
    const forged = `${header}.${body}.${Buffer.from("not-a-signature").toString("base64url")}`;
    const verify = guardOver(fake).verifyToken(forged);
    await expect(verify).rejects.toThrow("Invalid token");
    expect(fake.selects).toHaveLength(0);
  });
}

export async function assertLocalModeResolvesById(): Promise<void> {
  await withEnv({ AUTH_MODE: "local" }, async () => {
    const local = new JwtService({ secret: "f3.78-local-secret" });
    const claims: JwtPayload = { sub: ID, email: "probe@bms.local", name: "Probe", role: "viewer" };
    const token = local.sign(claims);
    const fake = authFake([ROW]);
    const payload = await new JwtAuthGuard(local, fake.db).verifyToken(token);
    expect(recalledIdentity(payload)?.id).toBe(ID);
    expect(fake.selects[0]).toContain('"id" = $1');
    expect(fake.updates).toBe(0);
  });
}
