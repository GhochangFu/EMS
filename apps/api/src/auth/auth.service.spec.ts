import { UnauthorizedException } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";
import bcrypt from "bcrypt";
import { expect, vi } from "vitest";

import type { BmsDb } from "@bms/db";

import { AuthService } from "./auth.service";

/**
 * `F3.78` / ADR 0089 decision 7 — `0098` makes `bms.users.password_hash`
 * nullable: a user created through the admin screen has a Keycloak password and
 * no local hash. Local login must refuse such a row with the generic 401 and
 * must not hand `null` to `bcrypt.compare`.
 */

type LoginRow = {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  role: string;
  disabledAt?: Date | null;
};

/** A fake auth pool: the login lookup answers `row`, the `last_login_at` stamp is a no-op. */
function fakeDb(row: LoginRow): BmsDb {
  const select = {
    from: () => select,
    where: () => select,
    limit: async () => [row],
  };
  const update = { set: () => update, where: async () => undefined };
  return { select: () => select, update: () => update } as unknown as BmsDb;
}

const jwt = { signAsync: async () => "token" } as unknown as JwtService;

const ROW: LoginRow = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "probe@bms.local",
  passwordHash: null,
  displayName: "Probe",
  role: "viewer",
};

/** Runs `fn` with local login enabled and a call-through `bcrypt.compare` spy, restoring both. */
async function withLocalLogin(fn: (compare: ReturnType<typeof vi.spyOn>) => Promise<void>): Promise<void> {
  const saved = { AUTH_MODE: process.env.AUTH_MODE, OIDC_ISSUER: process.env.OIDC_ISSUER };
  process.env.AUTH_MODE = "local";
  delete process.env.OIDC_ISSUER;
  // Calls through to the real bcrypt: a stub answering `false` would turn a NULL
  // hash into the same 401 with the guard deleted, so the 401 case could not redden.
  const compare = vi.spyOn(bcrypt, "compare");
  try {
    await fn(compare);
  } finally {
    compare.mockRestore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export async function assertANullHashIsTheGeneric401(): Promise<void> {
  await withLocalLogin(async () => {
    const service = new AuthService(fakeDb(ROW), jwt);
    const login = service.login({ email: ROW.email, password: "anything" });
    await expect(login).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(login).rejects.toThrow("Invalid email or password");
  });
}

export async function assertANullHashNeverReachesBcrypt(): Promise<void> {
  await withLocalLogin(async (compare) => {
    const service = new AuthService(fakeDb(ROW), jwt);
    await service.login({ email: ROW.email, password: "anything" }).catch(() => undefined);
    expect(compare).not.toHaveBeenCalled();
  });
}

/** Positive control for the spy: a row with a hash does reach `bcrypt.compare`. */
export async function assertAHashedRowReachesBcrypt(): Promise<void> {
  await withLocalLogin(async (compare) => {
    const service = new AuthService(fakeDb({ ...ROW, passwordHash: "$2b$10$hash" }), jwt);
    await service.login({ email: ROW.email, password: "anything" }).catch(() => undefined);
    expect(compare).toHaveBeenCalledTimes(1);
  });
}

/**
 * `F3.78` / ADR 0089 decision 8 — a deactivated row is the generic 401 before
 * `bcrypt.compare`. The fixture carries a real hash of the password sent, so
 * with the refusal deleted the login would succeed (a token, not a 401): the
 * case cannot pass on bcrypt's own refusal.
 */
export async function assertADisabledRowIsTheGeneric401BeforeBcrypt(): Promise<void> {
  const hash = await bcrypt.hash("right-password", 4);
  await withLocalLogin(async (compare) => {
    const row = { ...ROW, passwordHash: hash, disabledAt: new Date("2026-10-01T00:00:00Z") };
    const service = new AuthService(fakeDb(row), jwt);
    const login = service.login({ email: ROW.email, password: "right-password" });
    await expect(login).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(login).rejects.toThrow("Invalid email or password");
    expect(compare).not.toHaveBeenCalled();
  });
}

/** Positive control: the same row, not disabled, signs in — the hash and password match. */
export async function assertAnEnabledRowWithTheRightPasswordSignsIn(): Promise<void> {
  const hash = await bcrypt.hash("right-password", 4);
  await withLocalLogin(async () => {
    const service = new AuthService(fakeDb({ ...ROW, passwordHash: hash, disabledAt: null }), jwt);
    const response = await service.login({ email: ROW.email, password: "right-password" });
    expect(response.accessToken).toBe("token");
  });
}
