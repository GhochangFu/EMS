import { BadRequestException, ConflictException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { modbusConfigSchema, modbusDeviceSchema, type JwtPayload, type OnboardingDraft } from "@bms/shared";

import { RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE } from "../rtus/rtu-modbus-endpoint";
import { RTU_MODBUS_PROFILE_NOT_FOUND_MESSAGE } from "../rtus/rtus-modbus.service";
import type { BmsDb } from "@bms/db";

import type { OnboardingCommitService } from "./onboarding-commit.service";
import { modbusCommitConnection } from "./onboarding-commit-modbus";
import { newestDeviceProfilesByCode } from "./onboarding-device-profiles";

/**
 * `F1.2` plan PR 11 (ADR 0141 Amendment 1 (f), decision 23; Amendment 2 (a)) — the onboarding
 * commit binds a device profile, against a real database: the stored connection row is the RTUs
 * page bind's (registers copied, `profile: { code, version }`, canonical host), the ingest switch
 * is kept only with a profile, another organization's profile is "not found", and an endpoint
 * another organization's cloud-served RTU uses is the bind's 409. The sibling `.test.ts` owns the
 * lifecycle. **Each case is self-contained**: its own draft codes, endpoint host and profile.
 */

export type OnboardingModbusFixtures = {
  commit: OnboardingCommitService;
  /** `bms_tenant`: the profile-code lookup the chat and the workbook use. */
  tenantDb: BmsDb;
  /** `bms_fleet` (BYPASSRLS): runs the two profile reads with no tenant policy to lean on. */
  fleetDb: BmsDb;
  /** `bms_fleet` (BYPASSRLS): reads rows back and seeds sessions. */
  observer: pg.Pool;
  /** The superuser: profile rows (append-only by privilege) and the other organization's RTU. */
  superPool: pg.Pool;
  admin: JwtPayload;
  stamp: string;
  orgA: string;
  orgB: string;
  locationB: string;
  domain: string;
  sessionIds: string[];
  /** Every committed location, for cleanup. */
  committedLocationIds: string[];
};

const SOURCE = { document: "F1.2 PR 11 fixture manual", revision: "R1", pages: "1" };

function registers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    sourceKey: `kw_${i}`,
    table: "holding",
    address: i * 2,
    type: "float32",
    wordOrder: "big",
    byteSwap: false,
    scale: 1,
    offset: 0,
  }));
}

async function profile(
  ctx: OnboardingModbusFixtures,
  organizationId: string,
  name: string,
  version = 1,
): Promise<{ id: string; code: string; version: number; registers: ReturnType<typeof registers> }> {
  const code = `f12o-${ctx.stamp}-${name}`;
  const regs = registers(3);
  const { rows } = await ctx.superPool.query<{ id: string }>(
    `INSERT INTO bms.device_profiles (organization_id, protocol, code, version, vendor, model, source, verified, registers)
     VALUES ($1, 'modbus_tcp', $2, $3, 'Vendor', 'Model', $4::jsonb, false, $5::jsonb) RETURNING id`,
    [organizationId, code, version, JSON.stringify(SOURCE), JSON.stringify(regs)],
  );
  return { id: rows[0]!.id, code, version, registers: regs };
}

function host(ctx: OnboardingModbusFixtures, name: string): string {
  return `f12o-${ctx.stamp}-${name}.local`;
}

/** A commit-ready draft: one Modbus RTU with `config`, one asset mapped to `kw_0` on it. */
function draft(
  ctx: OnboardingModbusFixtures,
  name: string,
  config: Record<string, unknown>,
  ingestEnabled?: boolean,
): OnboardingDraft {
  const code = `F12O-${ctx.stamp}-${name}`.toUpperCase();
  return {
    location: {
      code,
      slug: code.toLowerCase(),
      name: `F1.2 PR 11 ${name}`,
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [{ code: `${code}-RTU`, displayName: `${code} RTU`, protocol: "modbus_tcp", config, ingestEnabled }],
    // The seeded catalog holds `kw`; declared with no unit or domain, the commit reuses that row.
    pointKeys: [{ code: "kw", name: "Active Power" }],
    assets: [{ rtuIndex: 0, code: `${code}-AS`, name: `${code} asset`, siteName: "F1.2 site", domain: ctx.domain }],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "kw_0" }],
  } as OnboardingDraft;
}

async function seed(ctx: OnboardingModbusFixtures, d: OnboardingDraft): Promise<string> {
  const { rows } = await ctx.observer.query<{ id: string }>(
    `INSERT INTO bms.onboarding_sessions (organization_id, status, current_phase, draft)
     VALUES ($1, 'draft', 'review', $2::jsonb) RETURNING id`,
    [ctx.orgA, JSON.stringify(d)],
  );
  ctx.sessionIds.push(rows[0]!.id);
  return rows[0]!.id;
}

async function commitDraft(ctx: OnboardingModbusFixtures, d: OnboardingDraft) {
  const result = await ctx.commit.commit(ctx.admin, await seed(ctx, d));
  ctx.committedLocationIds.push(result.locationId);
  return result;
}

async function rejection(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => new Error("expected a refusal, got a result"),
    (err: unknown) => err,
  );
}

async function storedRtu(ctx: OnboardingModbusFixtures, rtuId: string) {
  const { rows } = await ctx.observer.query<{ ingest_enabled: boolean; protocol: string; config: Record<string, unknown> }>(
    `SELECT r.ingest_enabled, c.protocol, c.config
       FROM bms.rtus r JOIN bms.rtu_connection_configs c ON c.rtu_id = r.id WHERE r.id = $1`,
    [rtuId],
  );
  return rows[0];
}

async function locationCommitted(ctx: OnboardingModbusFixtures, code: string): Promise<boolean> {
  const { rows } = await ctx.observer.query("SELECT 1 FROM bms.locations WHERE code = $1", [code]);
  return rows.length > 0;
}

/**
 * OM1 — a draft naming a profile commits the RTUs page bind's row: the profile's registers (deep
 * equal), `profile: { code, version }`, the unit id, the canonical host, no `profileId` key; the
 * row passes the adapter's own strict schemas.
 */
export async function assertAProfileIsCopiedIntoTheDeviceSlice(ctx: OnboardingModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "om1");
  const result = await commitDraft(
    ctx,
    draft(ctx, "om1", { host: host(ctx, "OM1").toUpperCase() + ".", pollIntervalMs: 15_000, profileId: p.id, device: { unitId: 7 } }),
  );
  const row = await storedRtu(ctx, result.rtuIds[0]);
  expect(row?.protocol).toBe("modbus_tcp");
  const { device, pollIntervalMs, ...connection } = row!.config as {
    device: Record<string, unknown>;
    pollIntervalMs?: number;
  } & Record<string, unknown>;
  expect(connection).toEqual({ host: host(ctx, "om1"), port: 502 });
  expect(pollIntervalMs).toBe(15_000);
  expect(device).toEqual({ unitId: 7, profile: { code: p.code, version: p.version }, registers: p.registers });
  expect(modbusConfigSchema.safeParse(connection).success).toBe(true);
  expect(modbusDeviceSchema.safeParse(device).success).toBe(true);
}

/** OM2 — with a profile, the draft's ingest switch is kept, and the asset goes to the ingest host. */
export async function assertABoundRtuKeepsIngestOn(ctx: OnboardingModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "om2");
  const result = await commitDraft(ctx, draft(ctx, "om2", { host: host(ctx, "om2"), profileId: p.id, device: { unitId: 1 } }, true));
  expect((await storedRtu(ctx, result.rtuIds[0]))?.ingest_enabled).toBe(true);
  const { rows } = await ctx.observer.query<{ meta: Record<string, unknown> }>("SELECT meta FROM bms.assets WHERE id = $1", [
    result.assetIds[0],
  ]);
  expect(rows[0]?.meta.telemetrySource).toBe("mqtt");
}

/** OM3 — without a profile, ingest is committed off and the config is the parsed draft (canonical host). */
export async function assertAnUnboundRtuIsCommittedWithIngestOff(ctx: OnboardingModbusFixtures): Promise<void> {
  const result = await commitDraft(ctx, draft(ctx, "om3", { host: host(ctx, "OM3").toUpperCase(), device: { unitId: 2 } }, true));
  const row = await storedRtu(ctx, result.rtuIds[0]);
  expect(row?.ingest_enabled).toBe(false);
  expect(row?.config).toEqual({ host: host(ctx, "om3"), device: { unitId: 2 } });
}

/** OM4 — another organization's profile is "not found" at `config.profileId`, and nothing is written. */
export async function assertAnotherOrganizationsProfileIsNotFound(ctx: OnboardingModbusFixtures): Promise<void> {
  const foreign = await profile(ctx, ctx.orgB, "om4");
  const d = draft(ctx, "om4", { host: host(ctx, "om4"), profileId: foreign.id, device: { unitId: 1 } }, true);
  const err = await rejection(ctx.commit.commit(ctx.admin, await seed(ctx, d)));
  expect(err).toBeInstanceOf(BadRequestException);
  const body = (err as BadRequestException).getResponse() as { errors: { path: string; message: string }[] };
  expect(body.errors).toEqual([{ path: "rtus.0.config.profileId", message: RTU_MODBUS_PROFILE_NOT_FOUND_MESSAGE }]);
  expect(JSON.stringify(body)).not.toContain(foreign.code);
  expect(await locationCommitted(ctx, d.location!.code)).toBe(false);
}

/**
 * OM5 — Amendment 2 (a) at commit: an endpoint another organization's active cloud-served RTU
 * uses is the bind's 409 (naming neither organization), whether or not the draft names a profile,
 * and nothing is written. Another port on that host is another endpoint and commits.
 */
export async function assertAnotherOrganizationsEndpointIs409(ctx: OnboardingModbusFixtures): Promise<void> {
  const { rows } = await ctx.superPool.query<{ id: string }>(
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type)
     VALUES ($1, $2, $3, 'F1.2 PR 11 holder', 'catalog') RETURNING id`,
    [ctx.orgB, ctx.locationB, `f12o-${ctx.stamp}-om5-holder`],
  );
  await ctx.superPool.query(
    `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config) VALUES ($1, $2, 'modbus_tcp', $3::jsonb)`,
    [ctx.orgB, rows[0]!.id, JSON.stringify({ host: host(ctx, "om5"), port: 502 })],
  );
  const p = await profile(ctx, ctx.orgA, "om5");
  for (const [name, config] of [
    ["om5a", { host: host(ctx, "OM5"), profileId: p.id, device: { unitId: 1 } }],
    ["om5b", { host: host(ctx, "om5"), port: 502 }],
  ] as const) {
    const d = draft(ctx, name, config);
    const err = await rejection(ctx.commit.commit(ctx.admin, await seed(ctx, d)));
    expect(err, name).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE);
    expect(await locationCommitted(ctx, d.location!.code), name).toBe(false);
  }
  const other = await commitDraft(ctx, draft(ctx, "om5c", { host: host(ctx, "om5"), port: 5020, profileId: p.id, device: { unitId: 1 } }));
  expect((await storedRtu(ctx, other.rtuIds[0]))?.config).toMatchObject({ host: host(ctx, "om5"), port: 5020 });
}

/** OM6 — the commit's audit row names each bound profile by code and version, and holds no register. */
export async function assertTheAuditNamesTheProfileAndNoRegister(ctx: OnboardingModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "om6", 2);
  const result = await commitDraft(ctx, draft(ctx, "om6", { host: host(ctx, "om6"), profileId: p.id, device: { unitId: 1 } }, true));
  const { rows } = await ctx.observer.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM bms.audit_log WHERE action = 'master.onboarding.commit' AND entity_id = $1`,
    [result.sessionId],
  );
  expect(rows[0]?.payload.modbusProfiles).toEqual([
    { rtuCode: `F12O-${ctx.stamp}-OM6-RTU`.toUpperCase(), profile: { code: p.code, version: 2 }, registerCount: 3, ingestEnabled: true },
  ]);
  expect(JSON.stringify(rows[0]?.payload)).not.toContain("kw_1");
}

/**
 * OM7 — the chat's and the workbook's code lookup (`newestDeviceProfilesByCode`): the newest
 * version of a code the organization holds; a code only another organization holds, an unknown
 * code and one outside the code class resolve to nothing.
 */
export async function assertACodeResolvesToTheOrganizationsNewestVersion(ctx: OnboardingModbusFixtures): Promise<void> {
  await profile(ctx, ctx.orgA, "om7", 1);
  const newest = await profile(ctx, ctx.orgA, "om7", 2);
  const foreign = await profile(ctx, ctx.orgB, "om7b", 1);
  const found = await newestDeviceProfilesByCode(ctx.tenantDb, ctx.orgA, [newest.code, foreign.code, "no-such-code", "not a code!"]);
  expect([...found.entries()]).toEqual([[newest.code, { id: newest.id, code: newest.code, version: 2 }]]);
}

/**
 * OM8 — PR 11 security review L3: the organization predicate of both profile reads holds on its
 * own. Run on `bms_fleet`, which bypasses row-level security, the commit's profile read and the
 * code lookup still do not see another organization's profile — so removing the explicit
 * predicate reddens this case, where under `bms_tenant` the policy alone would hide the row.
 */
export async function assertTheProfileReadsNameTheOrganization(ctx: OnboardingModbusFixtures): Promise<void> {
  const foreign = await profile(ctx, ctx.orgB, "om8");
  // The control: on this pool the row is visible to a read that does not filter by organization.
  const { rows } = await ctx.observer.query("SELECT 1 FROM bms.device_profiles WHERE id = $1", [foreign.id]);
  expect(rows.length).toBe(1);

  expect((await newestDeviceProfilesByCode(ctx.fleetDb, ctx.orgA, [foreign.code])).size).toBe(0);
  const rtu = {
    index: 0,
    code: "OM8",
    config: { host: host(ctx, "om8"), profileId: foreign.id, device: { unitId: 1 } },
    endpoint: { host: host(ctx, "om8"), port: 502 },
  };
  const err = await rejection(
    ctx.fleetDb.transaction((tx) => modbusCommitConnection(tx, ctx.orgA, rtu, { error: () => undefined })),
  );
  expect(err).toBeInstanceOf(BadRequestException);
}

/** OM9 — PR 11 review L8: two Modbus RTUs of one draft on one endpoint are one organization's, and commit. */
export async function assertTwoDraftRtusMayShareAnEndpoint(ctx: OnboardingModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "om9");
  const d = draft(ctx, "om9", { host: host(ctx, "om9"), profileId: p.id, device: { unitId: 1 } }, true);
  const code = d.location!.code;
  d.rtus = [
    ...d.rtus!,
    { code: `${code}-RTU2`, displayName: `${code} RTU 2`, protocol: "modbus_tcp", config: { host: host(ctx, "OM9"), port: 502, device: { unitId: 2 } } },
  ];
  const result = await commitDraft(ctx, d);
  expect(result.rtuIds).toHaveLength(2);
  expect((await storedRtu(ctx, result.rtuIds[1]))?.config).toEqual({ host: host(ctx, "om9"), port: 502, device: { unitId: 2 } });
}
