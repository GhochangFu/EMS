import type { Socket } from "socket.io";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { AlarmListItem, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SocketRegistry } from "../auth/socket-registry";
import type { MetricsService } from "../observability/metrics.service";
import type { DeviceAlarmScope } from "./alarm-scope";
import { AlarmsGateway } from "./alarms.gateway";

/**
 * `F3.16` (plan B5, ADR 0127 decision 14) — `emitScoped` over a fake
 * namespace: which socket receives a device alarm. The socket's scope is what
 * `handleConnection` caches (`assetIds`, and the device half the gateway reads
 * from them); the host alarm's organization is read per event, because the
 * list item does not carry it.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const RTU_1 = "00000000-0000-4000-8000-0000000000e1";
const RTU_2 = "00000000-0000-4000-8000-0000000000e2";
const ASSET = "00000000-0000-4000-8000-0000000000a1";

type FakeClient = {
  data: Record<string, unknown>;
  got: unknown[];
  emit: (event: string, body: unknown) => void;
  disconnect: () => void;
};

function client(assetIds: string[] | null, deviceScope?: DeviceAlarmScope): FakeClient {
  const got: unknown[] = [];
  return {
    data: { assetIds, deviceScope },
    disconnect: () => undefined,
    got,
    emit: (_event, body) => {
      got.push(body);
    },
  };
}

const metrics = { countWebsocketEvent: () => undefined, countAlarmEvent: () => undefined } as unknown as MetricsService;

/** A fleet handle answering the two reads: the host alarm's organization and the socket's device scope. */
function fakeDb(organizationId: string | null, scopeRows: { kind: "rtu" | "org"; id: string }[] = []): BmsDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => (organizationId === null ? [] : [{ organizationId }]),
  };
  return { select: () => chain, execute: async () => ({ rows: scopeRows }) } as unknown as BmsDb;
}

function gatewayWith(db: BmsDb | undefined, clients: FakeClient[], access?: Partial<AccessControlService>): AlarmsGateway {
  const gateway = new AlarmsGateway(
    metrics,
    { verifyToken: async () => ({}) as JwtPayload } as unknown as JwtAuthGuard,
    (access ?? {}) as AccessControlService,
    new SocketRegistry(),
    undefined,
    undefined,
    db,
  );
  gateway.server = { sockets: new Map(clients.map((c, i) => [`c${i}`, c])) } as unknown as AlarmsGateway["server"];
  return gateway;
}

function alarm(over: Partial<AlarmListItem>): AlarmListItem {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    assetId: null,
    ruleKey: null,
    ruleId: null,
    severity: "warning",
    message: "Communication lost: R1",
    raisedAt: "2026-11-11T00:00:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    assetCode: null,
    assetRtuName: null,
    assetLocationName: null,
    assetName: null,
    siteName: null,
    source: "rtu_comms",
    rtuId: RTU_1,
    rtuCode: "R1",
    severityRank: 30,
    locationName: null,
    ...over,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

export async function assertAnRtuAlarmReachesTheSocketsServedByThatRtu(): Promise<void> {
  const onRtu1 = client([ASSET], { rtuIds: [RTU_1], hostOrganizationIds: [] });
  const onRtu2 = client([ASSET], { rtuIds: [RTU_2], hostOrganizationIds: [ORG_A] });
  const admin = client(null);
  const gateway = gatewayWith(fakeDb(ORG_A), [onRtu1, onRtu2, admin]);
  gateway.broadcastCreated(alarm({}));
  await flush();
  expect(onRtu1.got, "a socket with an asset on the RTU receives its alarm").toEqual([
    { type: "created", alarm: alarm({}) },
  ]);
  expect(onRtu2.got, "a socket on another RTU does not").toEqual([]);
  expect(admin.got, "the unscoped socket receives every alarm").toHaveLength(1);
}

export async function assertTheHostAlarmReachesSocketsOnAMonitoredRtuOfItsOrganization(): Promise<void> {
  const host = alarm({ source: "ingest_host", rtuId: null, rtuCode: null, message: "Ingest host not reporting" });
  const inA = client([ASSET], { rtuIds: [], hostOrganizationIds: [ORG_A] });
  const inB = client([ASSET], { rtuIds: [RTU_1], hostOrganizationIds: [ORG_B] });
  const admin = client(null);
  const gateway = gatewayWith(fakeDb(ORG_A), [inA, inB, admin]);
  gateway.broadcastAcknowledged(host);
  await flush();
  expect(inA.got).toEqual([{ type: "acknowledged", alarm: host }]);
  expect(inB.got, "another organization's socket never receives it").toEqual([]);
  expect(admin.got).toHaveLength(1);
}

export async function assertARuleAlarmIsScopedByItsAssetAsBefore(): Promise<void> {
  const rule = alarm({ source: "rule", assetId: ASSET, rtuId: null, rtuCode: null, assetCode: "A-1" });
  const holds = client([ASSET], { rtuIds: [RTU_1], hostOrganizationIds: [ORG_A] });
  const lacks = client(["00000000-0000-4000-8000-0000000000a2"], { rtuIds: [RTU_1], hostOrganizationIds: [ORG_A] });
  const gateway = gatewayWith(fakeDb(ORG_A), [holds, lacks]);
  gateway.broadcastCleared(rule);
  await flush();
  expect(holds.got).toEqual([{ type: "cleared", alarm: rule }]);
  expect(lacks.got).toEqual([]);
}

export async function assertWithoutADeviceScopeAScopedSocketGetsNoDeviceAlarm(): Promise<void> {
  const scoped = client([ASSET]);
  const admin = client(null);
  const gateway = gatewayWith(undefined, [scoped, admin]);
  gateway.broadcastCreated(alarm({}));
  gateway.broadcastCreated(alarm({ source: "ingest_host", rtuId: null, rtuCode: null }));
  await flush();
  expect(scoped.got, "no device scope, no device alarm (fail closed)").toEqual([]);
  expect(admin.got, "the unscoped socket still receives both").toHaveLength(2);
}

export async function assertAnUnknownHostAlarmOrganizationReachesOnlyUnscopedSockets(): Promise<void> {
  const scoped = client([ASSET], { rtuIds: [], hostOrganizationIds: [ORG_A] });
  const admin = client(null);
  const gateway = gatewayWith(fakeDb(null), [scoped, admin]);
  gateway.broadcastCreated(alarm({ source: "ingest_host", rtuId: null, rtuCode: null }));
  await flush();
  expect(scoped.got).toEqual([]);
  expect(admin.got).toHaveLength(1);
}

export async function assertTheHandshakeCachesTheDeviceScope(): Promise<void> {
  const db = fakeDb(ORG_A, [
    { kind: "rtu", id: RTU_1 },
    { kind: "org", id: ORG_A },
  ]);
  const socket = Object.assign(client(null), { handshake: { auth: { token: "a-token" }, headers: {} } });
  const gateway = gatewayWith(db, [socket], {
    resolveUserId: () => null,
    readableAssetIds: async () => [ASSET],
  });
  await gateway.handleConnection(socket as unknown as Socket);
  expect(socket.data.assetIds).toEqual([ASSET]);
  expect(socket.data.deviceScope).toEqual({ rtuIds: [RTU_1], hostOrganizationIds: [ORG_A] });

  const admin = Object.assign(client([]), { handshake: { auth: { token: "a-token" }, headers: {} } });
  const adminGateway = gatewayWith(db, [admin], { resolveUserId: () => null, readableAssetIds: async () => null });
  await adminGateway.handleConnection(admin as unknown as Socket);
  expect(admin.data.deviceScope, "the global admin needs no device scope").toBeNull();
}
