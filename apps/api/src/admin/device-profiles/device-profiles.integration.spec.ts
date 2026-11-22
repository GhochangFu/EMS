import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { DeviceProfile, DeviceProfileDto, JwtPayload } from "@bms/shared";

import type { DeviceProfilesAdminService } from "./device-profiles.service";
import { STALE_BASE_MESSAGE } from "./device-profiles.service";

/**
 * `F1.2` (ADR 0141 decisions 12–14, Amendment 2 (b); plan T5.2) — the
 * profiles API against a real database: Row Level Security on the tenant
 * pool, the append-only grants of migration `0164`, the unique key that
 * settles a race, and the audit rows. The sibling `.test.ts` owns the
 * lifecycle (two fresh organizations, one organization admin on each) and
 * hands the service a **fixture stock list** through its DI token: the
 * shipped `STOCK_MODBUS_PROFILES` is empty until plan PR 9, and the
 * peer-edit property needs an entry whose registers the test controls.
 */

export type DeviceProfileFixtures = {
  svc: DeviceProfilesAdminService;
  /** `bms_fleet`: reads every organization's rows for the assertions. */
  observer: pg.Pool;
  stamp: string;
  orgA: string;
  orgB: string;
  adminA: JwtPayload;
  adminAId: string;
  adminB: JwtPayload;
  locationAdmin: JwtPayload;
  /** `STOCK[0]` is imported by I4, `STOCK[1]` by I5, so the two never share a code. */
  stock: readonly DeviceProfile[];
  /** Every row this suite wrote, for the audit check and the cleanup. */
  written: DeviceProfileDto[];
};

const SOURCE = { document: "F1.2 fixture manual", revision: "R1", pages: "1-2" };

/**
 * `count` holding registers with distinct keys, every default written out as a
 * stored row has it. Not parsed, so 257 can be built to be refused.
 */
export function registers(count: number, prefix = "kw"): DeviceProfile["registers"] {
  return Array.from({ length: count }, (_, i) => ({
    sourceKey: `${prefix}_${i}`,
    table: "holding" as const,
    address: i,
    type: "uint16" as const,
    wordOrder: "big" as const,
    byteSwap: false,
    scale: 1,
    offset: 0,
  }));
}

/** The fixture stock list: verified entries, so an import's `true` is visible. */
export function fixtureStock(stamp: string): DeviceProfile[] {
  return [
    { code: `f12-stock-${stamp}`, version: 3, vendor: "Stock", model: "S1", source: SOURCE, verified: true, registers: registers(2, "stock") },
    { code: `f12-peer-${stamp}`, version: 1, vendor: "Stock", model: "S2", source: SOURCE, verified: true, registers: registers(3, "repo") },
  ];
}

async function track(ctx: DeviceProfileFixtures, run: Promise<DeviceProfileDto>): Promise<DeviceProfileDto> {
  const row = await run;
  ctx.written.push(row);
  return row;
}

function createBody(ctx: DeviceProfileFixtures, organizationId: string, suffix: string, count = 2) {
  return { organizationId, code: `f12-${ctx.stamp}-${suffix}`, vendor: "Vendor", model: "Model", source: SOURCE, registers: registers(count) };
}

function saveBody(baseVersion: number, prefix = "kw") {
  return { baseVersion, vendor: "Vendor", model: "Model", source: SOURCE, registers: registers(2, prefix) };
}

async function rejection(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => new Error("expected a refusal, got a result"),
    (err: unknown) => err,
  );
}

/** I1 — organization B's admin gets 404 on A's profile, and A's never appear in B's list; a location admin may not write. */
export async function assertOrganizationsAreIsolated(ctx: DeviceProfileFixtures): Promise<void> {
  const a = await track(ctx, ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "iso")));
  expect(a.organizationId).toBe(ctx.orgA);
  expect((await ctx.svc.getById(ctx.adminA, a.id)).id).toBe(a.id);

  for (const run of [
    () => ctx.svc.getById(ctx.adminB, a.id),
    () => ctx.svc.saveVersion(ctx.adminB, a.id, saveBody(1)),
    () => ctx.svc.copy(ctx.adminB, a.id, { code: `f12-${ctx.stamp}-stolen` }),
    () => ctx.svc.list(ctx.adminB, { organizationId: ctx.orgA }),
    () => ctx.svc.create(ctx.adminB, createBody(ctx, ctx.orgA, "intrude")),
    () => ctx.svc.importStock(ctx.adminB, ctx.stock[0]!.code, { organizationId: ctx.orgA }),
  ]) {
    expect(await rejection(run())).toBeInstanceOf(NotFoundException);
  }
  const b = await track(ctx, ctx.svc.create(ctx.adminB, createBody(ctx, ctx.orgB, "iso-b")));
  const listedB = await ctx.svc.list(ctx.adminB, { organizationId: ctx.orgB });
  expect(listedB.map((row) => row.id)).toEqual([b.id]);
  expect(listedB.every((row) => row.organizationId === ctx.orgB)).toBe(true);
  expect((await ctx.svc.list(ctx.adminA, { organizationId: ctx.orgA })).map((row) => row.id)).toContain(a.id);

  expect(await rejection(ctx.svc.create(ctx.locationAdmin, createBody(ctx, ctx.orgA, "loc")))).toBeInstanceOf(
    ForbiddenException,
  );
  const { rows } = await ctx.observer.query("SELECT 1 FROM bms.device_profiles WHERE code = ANY($1::text[])", [
    [`f12-${ctx.stamp}-stolen`, `f12-${ctx.stamp}-intrude`, `f12-${ctx.stamp}-loc`],
  ]);
  expect(rows).toEqual([]);
}

async function snapshot(observer: pg.Pool, id: string): Promise<string> {
  const { rows } = await observer.query<{ row: string }>(
    "SELECT row_to_json(d)::text AS row FROM bms.device_profiles d WHERE id = $1",
    [id],
  );
  return rows[0]!.row;
}

async function versionsOf(observer: pg.Pool, organizationId: string, code: string): Promise<number[]> {
  const { rows } = await observer.query<{ version: number }>(
    "SELECT version FROM bms.device_profiles WHERE organization_id = $1 AND code = $2 ORDER BY version",
    [organizationId, code],
  );
  return rows.map((row) => row.version);
}

/**
 * I2 — a save never updates a row: the row count rises by one and the old row
 * is byte-equal. `created_by` is the caller's id. I3 — a second save from the
 * same base is 409, and two saves racing from one base land exactly one row.
 */
export async function assertASaveIsANewRowAndAStaleSaveIs409(ctx: DeviceProfileFixtures): Promise<void> {
  const v1 = await track(ctx, ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "append")));
  expect([v1.version, v1.verified, v1.createdBy]).toEqual([1, false, ctx.adminAId]);
  const before = await snapshot(ctx.observer, v1.id);

  const v2 = await track(ctx, ctx.svc.saveVersion(ctx.adminA, v1.id, saveBody(1, "edit")));
  expect([v2.code, v2.version, v2.createdBy]).toEqual([v1.code, 2, ctx.adminAId]);
  expect(v2.id).not.toBe(v1.id);
  expect(v2.registers.map((r) => r.sourceKey)).toEqual(["edit_0", "edit_1"]);
  expect(await versionsOf(ctx.observer, ctx.orgA, v1.code)).toEqual([1, 2]);
  expect(await snapshot(ctx.observer, v1.id)).toBe(before);

  // The same base again: someone already saved version 2 from it.
  const stale = await rejection(ctx.svc.saveVersion(ctx.adminA, v1.id, saveBody(1)));
  expect(stale).toBeInstanceOf(ConflictException);
  expect((stale as ConflictException).message).toBe(STALE_BASE_MESSAGE);
  expect(await versionsOf(ctx.observer, ctx.orgA, v1.code)).toEqual([1, 2]);

  // Two editors on version 2 at once: the unique key admits one (23505 -> 409 for the other).
  const raced = await Promise.allSettled([
    ctx.svc.saveVersion(ctx.adminA, v2.id, saveBody(2, "left")),
    ctx.svc.saveVersion(ctx.adminA, v2.id, saveBody(2, "right")),
  ]);
  const landed = raced.filter((r): r is PromiseFulfilledResult<DeviceProfileDto> => r.status === "fulfilled");
  const refused = raced.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  expect(landed).toHaveLength(1);
  expect(refused).toHaveLength(1);
  expect(refused[0]!.reason).toBeInstanceOf(ConflictException);
  ctx.written.push(landed[0]!.value);
  expect(await versionsOf(ctx.observer, ctx.orgA, v1.code)).toEqual([1, 2, 3]);
  expect(await snapshot(ctx.observer, v1.id)).toBe(before);
}

/** I4 — an import carries the stock file's `verified`; an edit and a copy of it reset `verified` to false (P2). */
export async function assertAnEditOrACopyResetsVerified(ctx: DeviceProfileFixtures): Promise<void> {
  const entry = ctx.stock[0]!;
  const imported = await track(ctx, ctx.svc.importStock(ctx.adminA, entry.code, { organizationId: ctx.orgA }));
  expect([imported.version, imported.verified, imported.stockCode, imported.stockVersion]).toEqual([
    1,
    true,
    entry.code,
    entry.version,
  ]);
  expect(imported.registers).toEqual(entry.registers);

  const edited = await track(ctx, ctx.svc.saveVersion(ctx.adminA, imported.id, saveBody(1)));
  expect([edited.version, edited.verified, edited.stockCode]).toEqual([2, false, null]);

  const copied = await track(ctx, ctx.svc.copy(ctx.adminA, imported.id, { code: `f12-${ctx.stamp}-copy` }));
  expect([copied.code, copied.version, copied.verified, copied.stockCode]).toEqual([`f12-${ctx.stamp}-copy`, 1, false, null]);
  expect(copied.registers).toEqual(imported.registers);
  // A copy onto a code the organization holds is a 409.
  expect(await rejection(ctx.svc.copy(ctx.adminA, imported.id, { code: `f12-${ctx.stamp}-copy` }))).toBeInstanceOf(
    ConflictException,
  );
  // Re-importing opens the next version of the code, from the stock file again.
  const again = await track(ctx, ctx.svc.importStock(ctx.adminA, entry.code, { organizationId: ctx.orgA }));
  expect([again.version, again.verified]).toEqual([3, true]);
}

/** I5 — an import after a peer organization edited its own copy still yields the repository's registers. */
export async function assertAnImportCopiesTheRepositoryNotAPeer(ctx: DeviceProfileFixtures): Promise<void> {
  const entry = ctx.stock[1]!;
  const peer = await track(ctx, ctx.svc.importStock(ctx.adminB, entry.code, { organizationId: ctx.orgB }));
  const peerEdit = await track(ctx, ctx.svc.saveVersion(ctx.adminB, peer.id, saveBody(1, "peer")));
  expect(peerEdit.registers.map((r) => r.sourceKey)).toEqual(["peer_0", "peer_1"]);

  const mine = await track(ctx, ctx.svc.importStock(ctx.adminA, entry.code, { organizationId: ctx.orgA }));
  expect(mine.organizationId).toBe(ctx.orgA);
  expect(mine.version).toBe(1);
  expect(mine.registers).toEqual(entry.registers);
  expect(mine.registers.map((r) => r.sourceKey)).toEqual(["repo_0", "repo_1", "repo_2"]);
}

/** I6 — 257 registers is a 400 on a create and a save, and 256 is stored. */
export async function assertTheRegisterBound(ctx: DeviceProfileFixtures): Promise<void> {
  expect(await rejection(ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "big", 257)))).toBeInstanceOf(
    BadRequestException,
  );
  const max = await track(ctx, ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "max", 256)));
  expect(max.registers).toHaveLength(256);
  const tooMany = { ...saveBody(1), registers: registers(257) };
  expect(await rejection(ctx.svc.saveVersion(ctx.adminA, max.id, tooMany))).toBeInstanceOf(BadRequestException);
  expect(await versionsOf(ctx.observer, ctx.orgA, `f12-${ctx.stamp}-big`)).toEqual([]);
  expect(await versionsOf(ctx.observer, ctx.orgA, max.code)).toEqual([1]);
}

/** I7 — every write has one audit row with the row's organization, code, version and register count, and no register list. */
export async function assertEveryWriteIsAudited(ctx: DeviceProfileFixtures): Promise<void> {
  expect(ctx.written.length).toBeGreaterThan(10);
  const { rows } = await ctx.observer.query<{
    entity_id: string;
    organization_id: string | null;
    action: string;
    payload: Record<string, unknown>;
    text: string;
  }>(
    "SELECT entity_id, organization_id, action, payload, payload::text AS text FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])",
    [ctx.written.map((row) => row.id)],
  );
  expect(rows).toHaveLength(ctx.written.length);
  const actions = new Set<string>();
  for (const written of ctx.written) {
    const audit = rows.find((row) => row.entity_id === written.id)!;
    actions.add(audit.action);
    expect(audit.organization_id).toBe(written.organizationId);
    expect(audit.payload).toMatchObject({
      code: written.code,
      version: written.version,
      verified: written.verified,
      registerCount: written.registers.length,
    });
    expect(audit.payload).not.toHaveProperty("registers");
    for (const register of written.registers) {
      expect(audit.text).not.toContain(`"${register.sourceKey}"`);
    }
  }
  expect([...actions].sort()).toEqual([
    "master.device_profile.copy",
    "master.device_profile.create",
    "master.device_profile.import",
    "master.device_profile.save_version",
  ]);
}
