import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { DeviceProfile, JwtPayload } from "@bms/shared";

import { DeviceProfilesAdminService, STOCK_PROFILE_NOT_FOUND_MESSAGE, WRITE_ROLE_MESSAGE } from "./device-profiles.service";

/**
 * `F1.2` (ADR 0141 decisions 12–14, plan T5.2) — the gate order 403 → 400 →
 * 404, with pools that throw if touched (the database claims, the 409s
 * included, are the integration spec's).
 */

const JWT = { sub: "u", email: "someone@bms.local", role: "organization_admin" } as unknown as JwtPayload;
const ORG = "6f1c2a8e-4b1d-4c55-9a43-0d6c1b2e3f40";
const SOURCE = { document: "Manual", revision: "R1", pages: "1" };
const REGISTERS = [{ sourceKey: "kwh", table: "holding", address: 0, type: "uint16" }];
const CREATE = { organizationId: ORG, code: "em", vendor: "V", model: "M", source: SOURCE, registers: REGISTERS };
const STOCK: DeviceProfile[] = [
  {
    code: "stock-em",
    version: 1,
    vendor: "V",
    model: "M",
    source: SOURCE,
    verified: true,
    registers: [{ sourceKey: "kwh", table: "holding", address: 0, type: "uint16", wordOrder: "big", byteSwap: false, scale: 1, offset: 0 }],
  },
];

/** A service whose pools throw if touched, so a gate that lets a call through reddens. */
function serviceFor(role: string, events: string[], organizationAdmin = true): DeviceProfilesAdminService {
  const untouched = new Proxy(
    {},
    {
      get: (_target, key) => {
        events.push(`db.${String(key)}`);
        throw new Error(`the database was reached (${String(key)})`);
      },
    },
  );
  const accessControl = {
    requireMasterDataUser: async () => {
      if (role === "viewer" || role === "operator") throw new ForbiddenException("master data only");
      return { id: "u-1", role };
    },
    canManageOrganization: async () => organizationAdmin,
    isOrganizationLevelAdmin: async () => organizationAdmin,
  };
  const audit = { write: async () => events.push("audit") };
  return new DeviceProfilesAdminService(untouched as never, untouched as never, accessControl as never, audit as never, STOCK);
}

/** Every write route with a malformed body, id and code, so a parse that ran before the gate shows as a 400. */
function everyWrite(svc: DeviceProfilesAdminService): Array<() => Promise<unknown>> {
  const body = { not: "a body" };
  return [
    () => svc.create(JWT, body),
    () => svc.saveVersion(JWT, "not-an-id", body),
    () => svc.copy(JWT, "not-an-id", body),
    () => svc.importStock(JWT, "bad code!", body),
  ];
}

/** G1 — a location admin is refused every write with 403, before any body is parsed or any row read. */
export async function aLocationAdminIsRefusedEveryWriteFirst(): Promise<void> {
  const events: string[] = [];
  const svc = serviceFor("location_admin", events);
  for (const run of everyWrite(svc)) {
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe(WRITE_ROLE_MESSAGE);
  }
  expect(events).toEqual([]);
}

/** G2 — a viewer is refused the reads with 403 before the query or the id is parsed. */
export async function aViewerIsRefusedTheReadsFirst(): Promise<void> {
  const events: string[] = [];
  const svc = serviceFor("viewer", events);
  for (const run of [() => svc.list(JWT, { bad: 1 }), () => svc.getById(JWT, "x"), () => svc.listStock(JWT)]) {
    expect(await run().catch((e: unknown) => e)).toBeInstanceOf(ForbiddenException);
  }
  expect(events).toEqual([]);
}

/** G3 — an organization admin with a malformed body, id, code or query gets 400 before any read. */
export async function aMalformedInputIsA400BeforeAnyRead(): Promise<void> {
  const events: string[] = [];
  const svc = serviceFor("organization_admin", events);
  for (const run of [...everyWrite(svc), () => svc.list(JWT, {}), () => svc.getById(JWT, "nope")]) {
    expect(await run().catch((e: unknown) => e)).toBeInstanceOf(BadRequestException);
  }
  // 257 registers is the shared bound, a 400 here too.
  const many = Array.from({ length: 257 }, (_, i) => ({ ...REGISTERS[0], sourceKey: `k${i}`, address: i }));
  expect(await svc.create(JWT, { ...CREATE, registers: many }).catch((e: unknown) => e)).toBeInstanceOf(BadRequestException);
  expect(events).toEqual([]);
}

/** G4 — an organization the caller may not reach is 404 on create, import and list, before any read. */
export async function anOrganizationOutOfReachIsA404BeforeAnyRead(): Promise<void> {
  const events: string[] = [];
  const svc = serviceFor("organization_admin", events, false);
  for (const run of [
    () => svc.create(JWT, CREATE),
    () => svc.importStock(JWT, "stock-em", { organizationId: ORG }),
    () => svc.list(JWT, { organizationId: ORG }),
  ]) {
    expect(await run().catch((e: unknown) => e)).toBeInstanceOf(NotFoundException);
  }
  expect(events).toEqual([]);
}

/** G5 — an unknown stock code is a 404 after the organization gate, and the stock list reads no database. */
export async function theStockListAndAnUnknownCode(): Promise<void> {
  const events: string[] = [];
  const svc = serviceFor("location_admin", events);
  const listed = await svc.listStock(JWT);
  expect(listed.map((entry) => [entry.code, entry.verified])).toEqual([["stock-em", true]]);
  const admin = serviceFor("organization_admin", events);
  const err = await admin.importStock(JWT, "not-shipped", { organizationId: ORG }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(NotFoundException);
  expect((err as NotFoundException).message).toBe(STOCK_PROFILE_NOT_FOUND_MESSAGE);
  expect(err).not.toBeInstanceOf(ConflictException);
  expect(events).toEqual([]);
}
