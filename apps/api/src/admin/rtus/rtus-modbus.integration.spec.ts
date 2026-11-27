import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { modbusConfigSchema, modbusDeviceSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { RtusModbusService } from "./rtus-modbus.service";
import type { RtusAdminService } from "./rtus.service";
import {
  RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE,
  RTU_MODBUS_INGEST_SOURCE_MESSAGE,
  RTU_MODBUS_OTHER_PROTOCOL_MESSAGE,
  RTU_MODBUS_PROFILE_NOT_FOUND_MESSAGE,
} from "./rtus-modbus.service";

/**
 * `F1.2` (ADR 0141 decisions 5, 6, 10 and 15, Amendment 2 (a); plan T7.2, builder call C10) —
 * `PUT /admin/rtus/:id/modbus` against a real database: what the connection row holds after a
 * bind, the refusals, the asset hand-over rule (`admin/telemetry-source.ts`) and the audit row.
 * The sibling `.test.ts` owns the lifecycle: two fresh organizations, an organization admin and a
 * location on each, profile rows inserted by the superuser (the table is append-only by
 * privilege, migration `0164`).
 *
 * **Every case is self-contained**: it creates its own RTUs (the case name in the code) on its
 * own endpoint host, so any one case runs alone or in any order.
 */

export type RtuModbusFixtures = {
  svc: RtusModbusService;
  rtus: RtusAdminService;
  /** `bms_fleet`: reads across organizations for the assertions and plants fixture rows. */
  observer: pg.Pool;
  /** The superuser: inserts profile rows (append-only by privilege). */
  superPool: pg.Pool;
  stamp: string;
  orgA: string;
  orgB: string;
  locationA: string;
  locationB: string;
  adminA: JwtPayload;
  adminB: JwtPayload;
  createdRtuIds: string[];
};

const SOURCE = { document: "F1.2 fixture manual", revision: "R1", pages: "1" };

/** A stored profile row's registers, every default written out (as a profile write stores them). */
function registers(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    sourceKey: `${prefix}_${i}`,
    table: "holding",
    address: i * 2,
    type: "float32",
    wordOrder: "big",
    byteSwap: false,
    scale: 1,
    offset: 0,
  }));
}

/** Inserts one profile row for `organizationId`; returns its id and registers. */
async function profile(
  ctx: RtuModbusFixtures,
  organizationId: string,
  name: string,
  version = 1,
  prefix = "kw",
  count = 3,
): Promise<{ id: string; code: string; version: number; registers: ReturnType<typeof registers> }> {
  const code = `f12-${ctx.stamp}-${name}`;
  const regs = registers(prefix, count);
  const { rows } = await ctx.superPool.query<{ id: string }>(
    `INSERT INTO bms.device_profiles (organization_id, protocol, code, version, vendor, model, source, verified, registers)
     VALUES ($1, 'modbus_tcp', $2, $3, 'Vendor', 'Model', $4::jsonb, false, $5::jsonb) RETURNING id`,
    [organizationId, code, version, JSON.stringify(SOURCE), JSON.stringify(regs)],
  );
  return { id: rows[0]!.id, code, version, registers: regs };
}

async function rtu(
  ctx: RtuModbusFixtures,
  side: "A" | "B",
  name: string,
  ingestEnabled = false,
  sourceType: "catalog" | "mqtt" | "simulator" = "catalog",
): Promise<string> {
  const created = await ctx.rtus.create(side === "A" ? ctx.adminA : ctx.adminB, {
    locationId: side === "A" ? ctx.locationA : ctx.locationB,
    code: `f12m-${ctx.stamp}-${name}`,
    displayName: `F1.2 Modbus ${name}`,
    sourceType,
    rtuCode: `F12M-${ctx.stamp}-${name}`.slice(0, 64),
    ingestEnabled,
  });
  ctx.createdRtuIds.push(created.id);
  return created.id;
}

async function storedRow(ctx: RtuModbusFixtures, rtuId: string): Promise<{ protocol: string; config: Record<string, unknown> } | undefined> {
  const { rows } = await ctx.observer.query<{ protocol: string; config: Record<string, unknown> }>(
    "SELECT protocol, config FROM bms.rtu_connection_configs WHERE rtu_id = $1",
    [rtuId],
  );
  return rows[0];
}

async function rejection(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => new Error("expected a refusal, got a result"),
    (err: unknown) => err,
  );
}

function host(ctx: RtuModbusFixtures, name: string): string {
  return `f12-${ctx.stamp}-${name}.local`;
}

/**
 * B1 — an RTU with no connection row gets one with `protocol = 'modbus_tcp'`; the stored
 * registers deep-equal the profile row's; `profile` is `{ code, version }`; the config passes the
 * adapter's own strict schemas; the answer carries the summary.
 */
export async function assertABindCreatesTheRowAndCopiesTheRegisters(ctx: RtuModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "b1");
  const id = await rtu(ctx, "A", "b1");
  expect(await storedRow(ctx, id)).toBeUndefined();

  const dto = await ctx.svc.bind(ctx.adminA, id, {
    host: host(ctx, "B1").toUpperCase(),
    port: 5020,
    pollIntervalMs: 30_000,
    unitId: 7,
    profileId: p.id,
  });
  const row = await storedRow(ctx, id);
  expect(row?.protocol).toBe("modbus_tcp");
  const { device, pollIntervalMs, ...connection } = row!.config;
  expect(device).toEqual({ unitId: 7, profile: { code: p.code, version: 1 }, registers: p.registers });
  expect(pollIntervalMs).toBe(30_000);
  expect(connection).toEqual({ host: host(ctx, "b1"), port: 5020 });
  expect(modbusConfigSchema.safeParse(connection).success).toBe(true);
  expect(modbusDeviceSchema.safeParse(device).success).toBe(true);
  expect(dto.modbus).toEqual({
    host: host(ctx, "b1"),
    port: 5020,
    unitId: 7,
    timeoutMs: null,
    interRequestDelayMs: null,
    pollIntervalMs: 30_000,
    profile: { code: p.code, version: 1 },
    registerCount: 3,
  });
}

/** B2 — a later version of the profile leaves the bound config byte-equal (decision 15). */
export async function assertALaterProfileVersionLeavesTheBindAlone(ctx: RtuModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "b2");
  const id = await rtu(ctx, "A", "b2");
  await ctx.svc.bind(ctx.adminA, id, { host: host(ctx, "b2"), pollIntervalMs: null, unitId: 1, profileId: p.id });
  const before = JSON.stringify((await storedRow(ctx, id))!.config);
  await profile(ctx, ctx.orgA, "b2", 2, "edited", 5);
  expect(JSON.stringify((await storedRow(ctx, id))!.config)).toBe(before);
  expect(before).not.toContain("edited_");
}

/** B3 — a profile of another organization is 404, an unknown one too, and nothing is written. */
export async function assertAnotherOrganizationsProfileIs404(ctx: RtuModbusFixtures): Promise<void> {
  const foreign = await profile(ctx, ctx.orgB, "b3");
  const id = await rtu(ctx, "A", "b3");
  for (const profileId of [foreign.id, "00000000-0000-4000-8000-000000000000"]) {
    const err = await rejection(ctx.svc.bind(ctx.adminA, id, { host: host(ctx, "b3"), pollIntervalMs: null, unitId: 1, profileId }));
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).message).toBe(RTU_MODBUS_PROFILE_NOT_FOUND_MESSAGE);
  }
  expect(await storedRow(ctx, id)).toBeUndefined();
}

/** B4 — an RTU whose connection row is MQTT is 409, and its row is left as it was. */
export async function assertAnMqttRowIs409(ctx: RtuModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "b4");
  const id = await rtu(ctx, "A", "b4");
  await ctx.observer.query(
    `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config)
     VALUES ($1, $2, 'mqtt', '{"host":"broker.local","port":8883}'::jsonb)`,
    [ctx.orgA, id],
  );
  const err = await rejection(ctx.svc.bind(ctx.adminA, id, { host: host(ctx, "b4"), pollIntervalMs: null, unitId: 1, profileId: p.id }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).message).toBe(RTU_MODBUS_OTHER_PROTOCOL_MESSAGE);
  expect(await storedRow(ctx, id)).toEqual({ protocol: "mqtt", config: { host: "broker.local", port: 8883 } });
}

/**
 * B5 — a re-bind replaces the config: `pollIntervalMs: null` removes the key, an omitted
 * `timeoutMs` removes it, and onboarding's legacy flat `unitId` (refused by the strict schema) is
 * gone. The existing row is updated, not duplicated.
 */
export async function assertARebindRewritesTheConfig(ctx: RtuModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "b5");
  const id = await rtu(ctx, "A", "b5");
  await ctx.observer.query(
    `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config)
     VALUES ($1, $2, 'modbus_tcp', $3::jsonb)`,
    [ctx.orgA, id, JSON.stringify({ host: host(ctx, "b5"), port: 502, unitId: 3, pollIntervalMs: 5000 })],
  );
  const first = await ctx.svc.bind(ctx.adminA, id, {
    host: host(ctx, "b5"),
    timeoutMs: 2500,
    pollIntervalMs: 20_000,
    unitId: 3,
    profileId: p.id,
  });
  expect(first.modbus).toMatchObject({ timeoutMs: 2500, pollIntervalMs: 20_000, unitId: 3 });
  const bound = (await storedRow(ctx, id))!.config;
  expect(bound).not.toHaveProperty("unitId");
  expect(bound).toMatchObject({ timeoutMs: 2500, pollIntervalMs: 20_000 });

  const second = await ctx.svc.bind(ctx.adminA, id, { host: host(ctx, "b5"), pollIntervalMs: null, unitId: 4, profileId: p.id });
  const rebound = (await storedRow(ctx, id))!.config;
  expect(rebound).not.toHaveProperty("pollIntervalMs");
  expect(rebound).not.toHaveProperty("timeoutMs");
  expect(rebound).not.toHaveProperty("unitId");
  expect(rebound.device).toMatchObject({ unitId: 4 });
  expect(second.modbus).toMatchObject({ pollIntervalMs: null, timeoutMs: null, unitId: 4 });
  const { rows } = await ctx.observer.query("SELECT 1 FROM bms.rtu_connection_configs WHERE rtu_id = $1", [id]);
  expect(rows).toHaveLength(1);
}

/** B6 — a body the contract refuses is a 400 before any read: 999 ms, a register list, an extra key. */
export async function assertABadBodyIs400(ctx: RtuModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "b6");
  const id = await rtu(ctx, "A", "b6");
  const ok = { host: host(ctx, "b6"), pollIntervalMs: null, unitId: 1, profileId: p.id };
  for (const body of [
    { ...ok, pollIntervalMs: 999 },
    { ...ok, registers: p.registers },
    { ...ok, unitId: 250 },
    { host: host(ctx, "b6"), unitId: 1, profileId: p.id },
  ]) {
    expect(await rejection(ctx.svc.bind(ctx.adminA, id, body))).toBeInstanceOf(BadRequestException);
  }
  expect(await storedRow(ctx, id)).toBeUndefined();
}

/**
 * B7 — an RTU with `ingest_enabled` hands its assets to the ingest host once the bind gives it a
 * connection row (the `F4.59` rule, `admin/telemetry-source.ts`); the merge keeps the bag's other
 * keys. An RTU with ingest off keeps its assets on `catalog`.
 */
export async function assertTheBindMovesTheAssetsByTheExistingRule(ctx: RtuModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "b7");
  const asset = async (rtuId: string, name: string): Promise<string> => {
    const { rows } = await ctx.observer.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, rtu_id, domain, meta)
       VALUES ($1, $2, $3, 'F1.2 site', $4, $5, 'electrical', '{"telemetrySource":"catalog","telemetryEnabled":true}'::jsonb)
       RETURNING id`,
      [ctx.orgA, `f12m-${ctx.stamp}-${name}`, `F1.2 asset ${name}`, ctx.locationA, rtuId],
    );
    return rows[0]!.id;
  };
  const meta = async (assetId: string) =>
    (await ctx.observer.query<{ meta: Record<string, unknown> }>("SELECT meta FROM bms.assets WHERE id = $1", [assetId])).rows[0]!
      .meta;

  const on = await rtu(ctx, "A", "b7-on", true);
  const off = await rtu(ctx, "A", "b7-off", false);
  const onAsset = await asset(on, "b7-on-asset");
  const offAsset = await asset(off, "b7-off-asset");
  await ctx.svc.bind(ctx.adminA, on, { host: host(ctx, "b7"), pollIntervalMs: null, unitId: 1, profileId: p.id });
  await ctx.svc.bind(ctx.adminA, off, { host: host(ctx, "b7"), pollIntervalMs: null, unitId: 2, profileId: p.id });
  expect(await meta(onAsset)).toEqual({ telemetrySource: "mqtt", telemetryEnabled: true });
  expect(await meta(offAsset)).toEqual({ telemetrySource: "catalog", telemetryEnabled: true });
}

/** B8 — one audit row in the RTU's organization with the profile reference and the count, never the list. */
export async function assertTheAuditHoldsNoRegisterList(ctx: RtuModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "b8", 1, "secretkey", 4);
  const id = await rtu(ctx, "A", "b8");
  await ctx.svc.bind(ctx.adminA, id, { host: host(ctx, "b8"), pollIntervalMs: 60_000, unitId: 9, profileId: p.id });
  const { rows } = await ctx.observer.query<{ action: string; organization_id: string; payload: Record<string, unknown> }>(
    "SELECT action, organization_id, payload FROM bms.audit_log WHERE entity_id = $1 AND action LIKE 'master.rtu.modbus%'",
    [id],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.action).toBe("master.rtu.modbus.update");
  expect(rows[0]!.organization_id).toBe(ctx.orgA);
  expect(rows[0]!.payload).toMatchObject({
    created: true,
    fromProfile: null,
    profile: { code: p.code, version: 1 },
    registerCount: 4,
    host: host(ctx, "b8"),
    port: 502,
    unitId: 9,
    pollIntervalMs: 60_000,
  });
  const text = JSON.stringify(rows[0]!.payload);
  expect(text).not.toContain("secretkey_");
  expect(text).not.toContain("registers");
}

/**
 * B9 — ADR 0141 Amendment 2 (a): an endpoint (`host:port`) already used by another
 * organization's RTU is a 409 naming neither organization, and writes nothing; a second RTU of
 * the **same** organization on that endpoint binds. The host is compared case-insensitively, and
 * a row with no `port` is the default 502.
 */
export async function assertAnotherOrganizationsEndpointIs409(ctx: RtuModbusFixtures): Promise<void> {
  const pA = await profile(ctx, ctx.orgA, "b9a");
  const pB = await profile(ctx, ctx.orgB, "b9b");
  const a1 = await rtu(ctx, "A", "b9-a1");
  await ctx.svc.bind(ctx.adminA, a1, { host: host(ctx, "b9"), pollIntervalMs: null, unitId: 1, profileId: pA.id });
  const a2 = await rtu(ctx, "A", "b9-a2");
  await ctx.svc.bind(ctx.adminA, a2, { host: host(ctx, "b9"), port: 502, pollIntervalMs: null, unitId: 2, profileId: pA.id });

  const b1 = await rtu(ctx, "B", "b9-b1");
  const err = await rejection(
    ctx.svc.bind(ctx.adminB, b1, { host: host(ctx, "B9").toUpperCase(), pollIntervalMs: null, unitId: 3, profileId: pB.id }),
  );
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).message).toBe(RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE);
  expect((err as ConflictException).message).not.toContain(ctx.orgA);
  expect(await storedRow(ctx, b1)).toBeUndefined();

  // A legacy row with no port is the default 502, so it holds the endpoint too.
  await ctx.observer.query(
    `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config)
     VALUES ($1, $2, 'modbus_tcp', $3::jsonb)`,
    [ctx.orgA, await rtu(ctx, "A", "b9-a3"), JSON.stringify({ host: host(ctx, "b9-legacy") })],
  );
  expect(
    await rejection(ctx.svc.bind(ctx.adminB, b1, { host: host(ctx, "b9-legacy"), port: 502, pollIntervalMs: null, unitId: 3, profileId: pB.id })),
  ).toBeInstanceOf(ConflictException);

  // Another port on the same host is another endpoint.
  const other = await ctx.svc.bind(ctx.adminB, b1, { host: host(ctx, "b9"), port: 5021, pollIntervalMs: null, unitId: 3, profileId: pB.id });
  expect(other.modbus).toMatchObject({ port: 5021 });
}

/** B10 — another organization's admin is 403 on the RTU, and an unknown RTU is 404. */
export async function assertTheGateIsTheLocations(ctx: RtuModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "b10");
  const id = await rtu(ctx, "A", "b10");
  const body = { host: host(ctx, "b10"), pollIntervalMs: null, unitId: 1, profileId: p.id };
  expect(await rejection(ctx.svc.bind(ctx.adminB, id, body))).toBeInstanceOf(ForbiddenException);
  expect(await rejection(ctx.svc.bind(ctx.adminA, "00000000-0000-4000-8000-000000000001", body))).toBeInstanceOf(
    NotFoundException,
  );
  expect(await storedRow(ctx, id)).toBeUndefined();
}

/**
 * B4b — PR 7 review H1: an RTU whose own `source_type` is an ingest protocol (`mqtt`) and that has no
 * connection row is a live MQTT RTU to the ingest host (`protocol ?? source_type`); a bind would
 * turn it into Modbus. 409, and the row stays absent. A `simulator` RTU still binds.
 */
export async function assertALiveMqttSourceIs409(ctx: RtuModbusFixtures): Promise<void> {
  const p = await profile(ctx, ctx.orgA, "b4b");
  const id = await rtu(ctx, "A", "b4b", true, "mqtt");
  const err = await rejection(ctx.svc.bind(ctx.adminA, id, { host: host(ctx, "b4b"), pollIntervalMs: null, unitId: 1, profileId: p.id }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).message).toBe(RTU_MODBUS_INGEST_SOURCE_MESSAGE);
  expect(await storedRow(ctx, id)).toBeUndefined();
  const sim = await rtu(ctx, "A", "b4b-sim", false, "simulator");
  await ctx.svc.bind(ctx.adminA, sim, { host: host(ctx, "b4b"), pollIntervalMs: null, unitId: 2, profileId: p.id });
  expect((await storedRow(ctx, sim))?.protocol).toBe("modbus_tcp");
}

/** Puts `rtuId` on a fresh edge gateway of its organization (superuser: the composite FK). */
async function edgeServe(ctx: RtuModbusFixtures, side: "A" | "B", rtuId: string, name: string): Promise<void> {
  const { rows } = await ctx.superPool.query<{ id: string }>(
    `INSERT INTO bms.edge_gateways (organization_id, location_id, code, name) VALUES ($1, $2, $3, $3) RETURNING id`,
    [side === "A" ? ctx.orgA : ctx.orgB, side === "A" ? ctx.locationA : ctx.locationB, `F12M-${ctx.stamp}-${name}`],
  );
  await ctx.superPool.query("UPDATE bms.rtus SET edge_gateway_id = $1 WHERE id = $2", [rows[0]!.id, rtuId]);
}

/**
 * B9b — PR 7 review H2: Amendment 2 (a) is a cloud-host rule. Another organization's RTU on the same
 * endpoint blocks only when it is active and cloud-served; an edge-served or an inactive one does
 * not; and binding an edge-served RTU is never blocked (the edge box serves one site).
 */
export async function assertOnlyACloudServedActiveRtuBlocks(ctx: RtuModbusFixtures): Promise<void> {
  const pA = await profile(ctx, ctx.orgA, "b9ba");
  const pB = await profile(ctx, ctx.orgB, "b9bb");
  const body = (endpoint: string, profileId: string, unitId: number) => ({ host: host(ctx, endpoint), pollIntervalMs: null, unitId, profileId });

  const edgeA = await rtu(ctx, "A", "b9b-edge");
  await ctx.svc.bind(ctx.adminA, edgeA, body("b9b-edge", pA.id, 1));
  await edgeServe(ctx, "A", edgeA, "b9b-gw-a");
  const b1 = await rtu(ctx, "B", "b9b-b1");
  expect((await ctx.svc.bind(ctx.adminB, b1, body("b9b-edge", pB.id, 2))).modbus).toMatchObject({ host: host(ctx, "b9b-edge") });

  const offA = await rtu(ctx, "A", "b9b-off");
  await ctx.svc.bind(ctx.adminA, offA, body("b9b-off", pA.id, 1));
  await ctx.observer.query("UPDATE bms.rtus SET active = false WHERE id = $1", [offA]);
  const b2 = await rtu(ctx, "B", "b9b-b2");
  await ctx.svc.bind(ctx.adminB, b2, body("b9b-off", pB.id, 2));

  // A cloud-served active RTU of A, and an edge-served RTU of B binding the same endpoint: not blocked.
  const cloudA = await rtu(ctx, "A", "b9b-cloud");
  await ctx.svc.bind(ctx.adminA, cloudA, body("b9b-cloud", pA.id, 1));
  const b3 = await rtu(ctx, "B", "b9b-b3");
  await edgeServe(ctx, "B", b3, "b9b-gw-b");
  await ctx.svc.bind(ctx.adminB, b3, body("b9b-cloud", pB.id, 2));
  // The control: a cloud-served RTU of B on that endpoint is still refused.
  const b4 = await rtu(ctx, "B", "b9b-b4");
  expect(await rejection(ctx.svc.bind(ctx.adminB, b4, body("b9b-cloud", pB.id, 3)))).toBeInstanceOf(ConflictException);
}

/** B9c — PR 7 review M1: another spelling of the same IPv6 address is the same endpoint. */
export async function assertAnotherSpellingIsTheSameEndpoint(ctx: RtuModbusFixtures): Promise<void> {
  const pA = await profile(ctx, ctx.orgA, "b9ca");
  const pB = await profile(ctx, ctx.orgB, "b9cb");
  // A stamp-derived group keeps the address unique to this run.
  const group = parseInt(ctx.stamp.slice(0, 4), 16).toString(16);
  const a = await rtu(ctx, "A", "b9c-a");
  await ctx.svc.bind(ctx.adminA, a, { host: `fd00::${group}`, pollIntervalMs: null, unitId: 1, profileId: pA.id });
  expect((await storedRow(ctx, a))!.config.host).toBe(`fd00:0:0:0:0:0:0:${group}`);
  const b = await rtu(ctx, "B", "b9c-b");
  const err = await rejection(
    ctx.svc.bind(ctx.adminB, b, { host: `FD00:0:0:0:0:0:0:${group.toUpperCase()}`, pollIntervalMs: null, unitId: 2, profileId: pB.id }),
  );
  expect(err).toBeInstanceOf(ConflictException);
  // A row stored before canonical hosts (`fd00:0::<g>`) is compared canonically too.
  const legacy = await rtu(ctx, "A", "b9c-legacy");
  await ctx.observer.query(
    "INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config) VALUES ($1, $2, 'modbus_tcp', $3::jsonb)",
    [ctx.orgA, legacy, JSON.stringify({ host: `FD00:0::${group}`, port: 5022 })],
  );
  expect(
    await rejection(ctx.svc.bind(ctx.adminB, b, { host: `fd00::${group}`, port: 5022, pollIntervalMs: null, unitId: 2, profileId: pB.id })),
  ).toBeInstanceOf(ConflictException);
}

/**
 * B11 — PR 7 review L1 (race): two organizations binding one endpoint at the same moment serialise on
 * the endpoint lock, so exactly one wins and the other is the 409.
 */
export async function assertConcurrentBindsSerialise(ctx: RtuModbusFixtures): Promise<void> {
  const pA = await profile(ctx, ctx.orgA, "b11a");
  const pB = await profile(ctx, ctx.orgB, "b11b");
  for (let round = 0; round < 5; round += 1) {
    const a = await rtu(ctx, "A", `b11-a${round}`);
    const b = await rtu(ctx, "B", `b11-b${round}`);
    const endpoint = host(ctx, `b11-${round}`);
    const results = await Promise.allSettled([
      ctx.svc.bind(ctx.adminA, a, { host: endpoint, pollIntervalMs: null, unitId: 1, profileId: pA.id }),
      ctx.svc.bind(ctx.adminB, b, { host: endpoint, pollIntervalMs: null, unitId: 1, profileId: pB.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled"), `round ${round}`).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(ConflictException);
  }
}

/**
 * B12 — PR 11 security review L1 (Amendment 2 (a)): reactivating a cloud-served Modbus RTU onto an
 * endpoint another organization's active cloud-served RTU now holds is the bind's 409, and the RTU
 * stays inactive; once that RTU is deactivated, the reactivation goes through.
 */
export async function assertReactivationKeepsOneOrganizationPerEndpoint(ctx: RtuModbusFixtures): Promise<void> {
  const pA = await profile(ctx, ctx.orgA, "b12a");
  const pB = await profile(ctx, ctx.orgB, "b12b");
  const a = await rtu(ctx, "A", "b12-a");
  await ctx.svc.bind(ctx.adminA, a, { host: host(ctx, "b12"), pollIntervalMs: null, unitId: 1, profileId: pA.id });
  await ctx.rtus.deactivate(ctx.adminA, a);
  const b = await rtu(ctx, "B", "b12-b");
  await ctx.svc.bind(ctx.adminB, b, { host: host(ctx, "B12"), pollIntervalMs: null, unitId: 2, profileId: pB.id });

  const err = await rejection(ctx.rtus.reactivate(ctx.adminA, a));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).message).toBe(RTU_MODBUS_ENDPOINT_OTHER_ORGANIZATION_MESSAGE);
  const { rows } = await ctx.observer.query<{ active: boolean }>("SELECT active FROM bms.rtus WHERE id = $1", [a]);
  expect(rows[0]?.active).toBe(false);

  await ctx.rtus.deactivate(ctx.adminB, b);
  expect((await ctx.rtus.reactivate(ctx.adminA, a)).active).toBe(true);
}
