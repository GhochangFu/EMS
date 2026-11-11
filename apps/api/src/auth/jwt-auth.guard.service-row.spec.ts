import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * `F4.17` / ADR 0125 decision 10, plan U9 — a service account is reached only
 * through a `bms_sat_` token (PR 4), never through a JWT. No login issues one
 * for it (local login filters `kind = 'human'`, and a service row has no OIDC
 * subject to match), so a JWT that names one is forged or mis-issued and the
 * guard refuses it with the generic 401.
 */

const SECRET = "f4.17-service-row-spec";
const jwt = new JwtService({ secret: SECRET });
const ID = "00000000-0000-4000-8000-0000000000e1";

function authDbAnswering(kind: "human" | "service"): BmsDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => [
      {
        id: ID,
        email: "svc@service-account.invalid",
        displayName: "svc",
        role: "operator",
        organizationId: "00000000-0000-4000-8000-0000000000d1",
        oidcSubject: null,
        disabledAt: null,
        kind,
      },
    ],
  };
  return { select: () => chain, update: () => chain } as unknown as BmsDb;
}

async function withLocalMode(fn: () => Promise<void>): Promise<void> {
  const saved = { AUTH_MODE: process.env.AUTH_MODE, OIDC_ISSUER: process.env.OIDC_ISSUER };
  process.env.AUTH_MODE = "local";
  delete process.env.OIDC_ISSUER;
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const token = () => jwt.sign({ sub: ID, email: "svc@service-account.invalid", name: "svc", role: "operator" });

/** A local JWT whose `sub` resolves to a `kind = 'service'` row is a 401. */
export async function assertAJwtNamingAServiceRowIsRefused(): Promise<void> {
  await withLocalMode(async () => {
    const guard = new JwtAuthGuard(jwt, authDbAnswering("service"));
    await expect(guard.verifyToken(token())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.verifyToken(token())).rejects.toThrow("Invalid token");
  });
}

/** Positive control: the same token over a `kind = 'human'` row verifies. */
export async function assertTheSameJwtNamingAHumanRowIsAccepted(): Promise<void> {
  await withLocalMode(async () => {
    const guard = new JwtAuthGuard(jwt, authDbAnswering("human"));
    expect((await guard.verifyToken(token())).sub).toBe(ID);
  });
}
