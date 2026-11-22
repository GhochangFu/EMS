import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { DeviceProfile, DeviceProfileDto, JwtPayload } from "@bms/shared";

import type { DeviceProfilesAdminService } from "./device-profiles.service";
import { codeTakenMessage, importRaceMessage, STALE_BASE_MESSAGE } from "./device-profiles.service";

/**
 * `F1.2` (ADR 0141 decisions 12–14, Amendment 2 (b); plan T5.2) — the
 * profiles API against a real database: Row Level Security on the tenant
 * pool, the append-only grants of migration `0164`, the unique key that
 * settles a race, and the audit rows. The sibling `.test.ts` owns the
 * lifecycle (two fresh organizations, an organization admin on each, a
 * location admin on a location of A) and hands the service a **fixture stock
 * list** through its DI token: the shipped `STOCK_MODBUS_PROFILES` is empty
 * until plan PR 9, and the import cases need entries whose registers the
 * test controls.
 *
 * **Every case is self-contained**: it writes its own codes (the case name in
 * the code), imports its own stock entry, and asserts only on rows and audit
 * rows it wrote, so any one case runs alone or in any order.
 */

export type DeviceProfileFixtures = {
  svc: DeviceProfilesAdminService;
  /** `bms_fleet`: reads every organization's rows for the assertions. */
  observer: pg.Pool;
  /** The superuser: holds a competing row uncommitted for the race cases. */
  superPool: pg.Pool;
  stamp: string;
  orgA: string;
  orgB: string;
  adminA: JwtPayload;
  adminAId: string;
  adminB: JwtPayload;
  /** A `location_admin` with one location of organization A and nothing of B. */
  locationAdminA: JwtPayload;
  stock: Readonly<Record<StockCase, DeviceProfile>>;
};

/** One stock entry per case that imports, so no two cases share a code. */
export type StockCase = "verified" | "peer" | "race" | "audit";

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
export function fixtureStock(stamp: string): Record<StockCase, DeviceProfile> {
  const entry = (name: StockCase, version: number, prefix: string, count: number): DeviceProfile => ({
    code: `f12-${name}-${stamp}`,
    version,
    vendor: "Stock",
    model: name,
    source: SOURCE,
    verified: true,
    registers: registers(count, prefix),
  });
  return {
    verified: entry("verified", 3, "stock", 2),
    peer: entry("peer", 1, "repo", 3),
    race: entry("race", 1, "race", 1),
    audit: entry("audit", 2, "aud", 2),
  };
}

function code(ctx: DeviceProfileFixtures, suffix: string): string {
  return `f12-${ctx.stamp}-${suffix}`;
}

function createBody(ctx: DeviceProfileFixtures, organizationId: string, suffix: string, count = 2) {
  return { organizationId, code: code(ctx, suffix), vendor: "Vendor", model: "Model", source: SOURCE, registers: registers(count) };
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

function expectConflict(err: unknown, message: string): void {
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).message).toBe(message);
}

async function snapshot(observer: pg.Pool, id: string): Promise<string> {
  const { rows } = await observer.query<{ row: string }>(
    "SELECT row_to_json(d)::text AS row FROM bms.device_profiles d WHERE id = $1",
    [id],
  );
  return rows[0]!.row;
}

async function versionsOf(observer: pg.Pool, organizationId: string, profileCode: string): Promise<number[]> {
  const { rows } = await observer.query<{ version: number }>(
    "SELECT version FROM bms.device_profiles WHERE organization_id = $1 AND code = $2 ORDER BY version",
    [organizationId, profileCode],
  );
  return rows.map((row) => row.version);
}

/** I1 — organization B's admin gets 404 on A's profile, and B's list holds none of A's rows; a location admin may not write. */
export async function assertOrganizationsAreIsolated(ctx: DeviceProfileFixtures): Promise<void> {
  const a = await ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "i1-a"));
  expect(a.organizationId).toBe(ctx.orgA);
  expect((await ctx.svc.getById(ctx.adminA, a.id)).id).toBe(a.id);

  for (const run of [
    () => ctx.svc.getById(ctx.adminB, a.id),
    () => ctx.svc.saveVersion(ctx.adminB, a.id, saveBody(1)),
    () => ctx.svc.copy(ctx.adminB, a.id, { code: code(ctx, "i1-stolen") }),
    () => ctx.svc.list(ctx.adminB, { organizationId: ctx.orgA }),
    () => ctx.svc.create(ctx.adminB, createBody(ctx, ctx.orgA, "i1-intrude")),
    () => ctx.svc.importStock(ctx.adminB, ctx.stock.verified.code, { organizationId: ctx.orgA }),
  ]) {
    expect(await rejection(run())).toBeInstanceOf(NotFoundException);
  }
  const b = await ctx.svc.create(ctx.adminB, createBody(ctx, ctx.orgB, "i1-b"));
  const listedB = await ctx.svc.list(ctx.adminB, { organizationId: ctx.orgB });
  expect(listedB.map((row) => row.id)).toContain(b.id);
  expect(listedB.map((row) => row.id)).not.toContain(a.id);
  expect(listedB.every((row) => row.organizationId === ctx.orgB)).toBe(true);
  expect((await ctx.svc.list(ctx.adminA, { organizationId: ctx.orgA })).map((row) => row.id)).toContain(a.id);

  expect(await rejection(ctx.svc.create(ctx.locationAdminA, createBody(ctx, ctx.orgA, "i1-loc")))).toBeInstanceOf(
    ForbiddenException,
  );
  expect(await rejection(ctx.svc.saveVersion(ctx.locationAdminA, a.id, saveBody(1)))).toBeInstanceOf(ForbiddenException);
  const { rows } = await ctx.observer.query("SELECT 1 FROM bms.device_profiles WHERE code = ANY($1::text[])", [
    [code(ctx, "i1-stolen"), code(ctx, "i1-intrude"), code(ctx, "i1-loc")],
  ]);
  expect(rows).toEqual([]);
}

/**
 * I1b — a location admin reads its organization's profiles (the RTU bind of
 * plan PR 7 lists them), and an organization it holds no location in stays 404.
 */
export async function assertALocationAdminReadsItsOrganization(ctx: DeviceProfileFixtures): Promise<void> {
  const a = await ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "i1b-a"));
  const b = await ctx.svc.create(ctx.adminB, createBody(ctx, ctx.orgB, "i1b-b"));
  expect((await ctx.svc.list(ctx.locationAdminA, { organizationId: ctx.orgA })).map((row) => row.id)).toContain(a.id);
  expect((await ctx.svc.getById(ctx.locationAdminA, a.id)).id).toBe(a.id);
  expect(await rejection(ctx.svc.list(ctx.locationAdminA, { organizationId: ctx.orgB }))).toBeInstanceOf(NotFoundException);
  expect(await rejection(ctx.svc.getById(ctx.locationAdminA, b.id))).toBeInstanceOf(NotFoundException);
}

/**
 * I2 — a save never updates a row: the row count rises by one and the old row
 * is byte-equal; `created_by` is the caller's id. A save whose base is not the
 * newest is 409, and so is one whose `baseVersion` names a newer row than the
 * `:id` it was made on.
 */
export async function assertASaveIsANewRowAndAStaleSaveIs409(ctx: DeviceProfileFixtures): Promise<void> {
  const v1 = await ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "i2"));
  expect([v1.version, v1.verified, v1.createdBy]).toEqual([1, false, ctx.adminAId]);
  const before = await snapshot(ctx.observer, v1.id);

  const v2 = await ctx.svc.saveVersion(ctx.adminA, v1.id, saveBody(1, "edit"));
  expect([v2.code, v2.version, v2.createdBy]).toEqual([v1.code, 2, ctx.adminAId]);
  expect(v2.id).not.toBe(v1.id);
  expect(v2.registers.map((r) => r.sourceKey)).toEqual(["edit_0", "edit_1"]);
  expect(await versionsOf(ctx.observer, ctx.orgA, v1.code)).toEqual([1, 2]);
  expect(await snapshot(ctx.observer, v1.id)).toBe(before);

  // The same base again: someone already saved version 2 from it.
  expectConflict(await rejection(ctx.svc.saveVersion(ctx.adminA, v1.id, saveBody(1))), STALE_BASE_MESSAGE);

  // v2 opened, v3 saved by someone else, then v2's editor claims base 3: still stale.
  const v2Snapshot = await snapshot(ctx.observer, v2.id);
  const v3 = await ctx.svc.saveVersion(ctx.adminA, v2.id, saveBody(2, "other"));
  expect(v3.version).toBe(3);
  expectConflict(await rejection(ctx.svc.saveVersion(ctx.adminA, v2.id, saveBody(3))), STALE_BASE_MESSAGE);
  expect(await versionsOf(ctx.observer, ctx.orgA, v1.code)).toEqual([1, 2, 3]);
  expect(await snapshot(ctx.observer, v1.id)).toBe(before);
  expect(await snapshot(ctx.observer, v2.id)).toBe(v2Snapshot);
}

/**
 * Holds `version` of `profileCode` uncommitted on the superuser, runs `write`,
 * waits until Postgres shows the API's INSERT blocked on that row's unique key,
 * then commits — so the API's statement fails with `23505`, deterministically.
 */
async function raceAgainstUncommittedRow(
  ctx: DeviceProfileFixtures,
  profileCode: string,
  version: number,
  write: () => Promise<unknown>,
): Promise<unknown> {
  const client = await ctx.superPool.connect();
  try {
    await client.query("BEGIN");
    const { rows: me } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await client.query(
      `INSERT INTO bms.device_profiles (organization_id, protocol, code, version, vendor, model, source, registers)
       VALUES ($1, 'modbus_tcp', $2, $3, 'Race', 'Race', $4::jsonb, $5::jsonb)`,
      [ctx.orgA, profileCode, version, JSON.stringify(SOURCE), JSON.stringify(registers(1, "held"))],
    );
    const pending = rejection(write());
    const deadline = Date.now() + 15_000;
    for (;;) {
      const { rows } = await ctx.superPool.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query ILIKE 'insert into%device_profiles%' AND pid <> $1`,
        [me[0]!.pid],
      );
      if (rows.length > 0) break;
      if (Date.now() > deadline) {
        await client.query("ROLLBACK");
        throw new Error("F1.2: the API's INSERT never blocked on the held row");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await client.query("COMMIT");
    return await pending;
  } finally {
    client.release();
  }
}

/**
 * I3 — the unique key settles what the stale check cannot see: a save and an
 * import whose next version another transaction holds uncommitted are each a
 * 409 once it commits (`23505`), and a create onto a held code is a 409.
 */
export async function assertTheUniqueKeySettlesEveryRace(ctx: DeviceProfileFixtures): Promise<void> {
  const v1 = await ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "i3-save"));
  const saved = await raceAgainstUncommittedRow(ctx, v1.code, 2, () =>
    ctx.svc.saveVersion(ctx.adminA, v1.id, saveBody(1)),
  );
  expectConflict(saved, STALE_BASE_MESSAGE);
  expect(await versionsOf(ctx.observer, ctx.orgA, v1.code)).toEqual([1, 2]);

  const entry = ctx.stock.race;
  const first = await ctx.svc.importStock(ctx.adminA, entry.code, { organizationId: ctx.orgA });
  expect(first.version).toBe(1);
  const imported = await raceAgainstUncommittedRow(ctx, entry.code, 2, () =>
    ctx.svc.importStock(ctx.adminA, entry.code, { organizationId: ctx.orgA }),
  );
  expectConflict(imported, importRaceMessage(entry.code));
  expect(await versionsOf(ctx.observer, ctx.orgA, entry.code)).toEqual([1, 2]);

  const taken = createBody(ctx, ctx.orgA, "i3-create");
  await ctx.svc.create(ctx.adminA, taken);
  expectConflict(await rejection(ctx.svc.create(ctx.adminA, taken)), codeTakenMessage(taken.code));
  expect(await versionsOf(ctx.observer, ctx.orgA, taken.code)).toEqual([1]);
}

/** I4 — an import carries the stock file's `verified`; an edit and a copy of it reset `verified` to false (P2). */
export async function assertAnEditOrACopyResetsVerified(ctx: DeviceProfileFixtures): Promise<void> {
  const entry = ctx.stock.verified;
  const imported = await ctx.svc.importStock(ctx.adminA, entry.code, { organizationId: ctx.orgA });
  expect([imported.version, imported.verified, imported.stockCode, imported.stockVersion]).toEqual([
    1,
    true,
    entry.code,
    entry.version,
  ]);
  expect(imported.registers).toEqual(entry.registers);

  const edited = await ctx.svc.saveVersion(ctx.adminA, imported.id, saveBody(1));
  expect([edited.version, edited.verified, edited.stockCode]).toEqual([2, false, null]);

  const copyCode = code(ctx, "i4-copy");
  const copied = await ctx.svc.copy(ctx.adminA, imported.id, { code: copyCode });
  expect([copied.code, copied.version, copied.verified, copied.stockCode]).toEqual([copyCode, 1, false, null]);
  expect(copied.registers).toEqual(imported.registers);
  // A copy onto a code the organization holds is a 409.
  expectConflict(await rejection(ctx.svc.copy(ctx.adminA, imported.id, { code: copyCode })), codeTakenMessage(copyCode));
  // Re-importing opens the next version of the code, from the stock file again.
  const again = await ctx.svc.importStock(ctx.adminA, entry.code, { organizationId: ctx.orgA });
  expect([again.version, again.verified]).toEqual([3, true]);
}

/** I5 — an import after a peer organization edited its own copy still yields the repository's registers. */
export async function assertAnImportCopiesTheRepositoryNotAPeer(ctx: DeviceProfileFixtures): Promise<void> {
  const entry = ctx.stock.peer;
  const peer = await ctx.svc.importStock(ctx.adminB, entry.code, { organizationId: ctx.orgB });
  const peerEdit = await ctx.svc.saveVersion(ctx.adminB, peer.id, saveBody(1, "peer"));
  expect(peerEdit.registers.map((r) => r.sourceKey)).toEqual(["peer_0", "peer_1"]);

  const mine = await ctx.svc.importStock(ctx.adminA, entry.code, { organizationId: ctx.orgA });
  expect(mine.organizationId).toBe(ctx.orgA);
  expect(mine.version).toBe(1);
  expect(mine.registers).toEqual(entry.registers);
  expect(mine.registers.map((r) => r.sourceKey)).toEqual(["repo_0", "repo_1", "repo_2"]);
}

/** I6 — 257 registers is a 400 on a create and a save, and 256 is stored. */
export async function assertTheRegisterBound(ctx: DeviceProfileFixtures): Promise<void> {
  expect(await rejection(ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "i6-big", 257)))).toBeInstanceOf(
    BadRequestException,
  );
  const max = await ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "i6-max", 256));
  expect(max.registers).toHaveLength(256);
  const tooMany = { ...saveBody(1), registers: registers(257) };
  expect(await rejection(ctx.svc.saveVersion(ctx.adminA, max.id, tooMany))).toBeInstanceOf(BadRequestException);
  expect(await versionsOf(ctx.observer, ctx.orgA, code(ctx, "i6-big"))).toEqual([]);
  expect(await versionsOf(ctx.observer, ctx.orgA, max.code)).toEqual([1]);
}

/**
 * I7 — each of the four writes has one audit row with the row's organization,
 * code, version and register count, and no register list.
 */
export async function assertEveryWriteIsAudited(ctx: DeviceProfileFixtures): Promise<void> {
  const created = await ctx.svc.create(ctx.adminA, createBody(ctx, ctx.orgA, "i7"));
  const saved = await ctx.svc.saveVersion(ctx.adminA, created.id, saveBody(1, "i7s"));
  const copied = await ctx.svc.copy(ctx.adminA, saved.id, { code: code(ctx, "i7-copy") });
  const imported = await ctx.svc.importStock(ctx.adminB, ctx.stock.audit.code, { organizationId: ctx.orgB });
  const written: [DeviceProfileDto, string][] = [
    [created, "master.device_profile.create"],
    [saved, "master.device_profile.save_version"],
    [copied, "master.device_profile.copy"],
    [imported, "master.device_profile.import"],
  ];

  const { rows } = await ctx.observer.query<{
    entity_id: string;
    organization_id: string | null;
    action: string;
    payload: Record<string, unknown>;
    text: string;
  }>(
    "SELECT entity_id, organization_id, action, payload, payload::text AS text FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])",
    [written.map(([row]) => row.id)],
  );
  expect(rows).toHaveLength(written.length);
  for (const [row, action] of written) {
    const audit = rows.find((candidate) => candidate.entity_id === row.id)!;
    expect(audit.action).toBe(action);
    expect(audit.organization_id).toBe(row.organizationId);
    expect(audit.payload).toMatchObject({
      code: row.code,
      version: row.version,
      verified: row.verified,
      registerCount: row.registers.length,
    });
    expect(audit.payload).not.toHaveProperty("registers");
    for (const register of row.registers) {
      expect(audit.text).not.toContain(`"${register.sourceKey}"`);
    }
  }
}
