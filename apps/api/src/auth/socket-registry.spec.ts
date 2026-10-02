import type { Socket } from "socket.io";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { AlarmsGateway } from "../alarms/alarms.gateway";
import type { MetricsService } from "../observability/metrics.service";
import type { ExistingAssetIds } from "../telemetry/existing-asset-ids";
import type { TelemetryBroadcastHub } from "../telemetry/telemetry-broadcast.hub";
import { TelemetryGateway } from "../telemetry/telemetry.gateway";
import type { AccessControlService } from "./access-control.service";
import type { JwtAuthGuard } from "./jwt-auth.guard";
import { SocketRegistry, type RegisteredSocket } from "./socket-registry";

/**
 * `F3.78` / ADR 0089 decision 8 — closing a deactivated user's sockets.
 *
 * The registry cases drive two fake namespaces. The gateway cases drive the
 * real `handleConnection` with a scope read that does not settle until the
 * case says so: a `bms_user_disabled` NOTIFY that lands **while** the scope is
 * being resolved must still find the socket, which holds only if
 * `client.data.userId` is set before that `await`. The later `disabled_at`
 * re-read answers "not disabled" here, so it cannot close the socket on the
 * NOTIFY's behalf and hide a late `userId`.
 */

const USER = "00000000-0000-4000-8000-0000000000f1";
const OTHER = "00000000-0000-4000-8000-0000000000f2";

type FakeSocket = RegisteredSocket & { closed: number };

function fakeSocket(userId: string | undefined): FakeSocket {
  const socket: FakeSocket = {
    data: { userId },
    closed: 0,
    disconnect: () => {
      socket.closed += 1;
    },
  };
  return socket;
}

function namespaceOf(...sockets: FakeSocket[]): { sockets: Map<string, RegisteredSocket> } {
  return { sockets: new Map(sockets.map((socket, i) => [`s${i}`, socket])) };
}

export function assertDisconnectsOnlyTheUsersSocketsAcrossNamespaces(): void {
  const registry = new SocketRegistry();
  const a1 = fakeSocket(USER);
  const a2 = fakeSocket(OTHER);
  const b1 = fakeSocket(USER);
  const b2 = fakeSocket(undefined);
  registry.register(namespaceOf(a1, a2));
  registry.register(namespaceOf(b1, b2));

  registry.disconnectUser(USER);

  expect([a1.closed, a2.closed, b1.closed, b2.closed]).toEqual([1, 0, 1, 0]);
}

export function assertReturnsTheCount(): void {
  const registry = new SocketRegistry();
  registry.register(namespaceOf(fakeSocket(USER), fakeSocket(OTHER)));
  registry.register(namespaceOf(fakeSocket(USER)));
  expect(registry.disconnectUser(USER)).toBe(2);
  expect(registry.disconnectUser("00000000-0000-4000-8000-0000000000ff")).toBe(0);
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Handshake = {
  registry: SocketRegistry;
  client: FakeSocket;
  scope: Deferred<string[] | null>;
  connecting: Promise<void>;
};

const PAYLOAD: JwtPayload = { sub: "kc-sub", email: "probe@bms.local", name: "Probe", role: "viewer" };

/** Starts a handshake on `gateway`'s `handleConnection`, its scope read held open. */
async function startHandshake(
  build: (jwt: JwtAuthGuard, access: AccessControlService, registry: SocketRegistry) => {
    handleConnection(client: Socket): Promise<void>;
    afterInit(): void;
    server: unknown;
  },
): Promise<Handshake> {
  const registry = new SocketRegistry();
  const scope = deferred<string[] | null>();
  const jwt = { verifyToken: async () => PAYLOAD } as unknown as JwtAuthGuard;
  const access = {
    resolveUserId: (payload: JwtPayload) => (payload === PAYLOAD ? USER : null),
    readableAssetIds: () => scope.promise,
    isUserDisabled: async () => false,
  } as unknown as AccessControlService;
  const gateway = build(jwt, access, registry);
  const client = Object.assign(fakeSocket(undefined), {
    data: {} as Record<string, unknown>,
    handshake: { auth: { token: "a-token" }, headers: {} },
  });
  gateway.server = { sockets: new Map([["c1", client]]) };
  gateway.afterInit();
  const connecting = gateway.handleConnection(client as unknown as Socket);
  // Let verifyToken settle; the scope read stays pending.
  await new Promise((r) => setImmediate(r));
  return { registry, client, scope, connecting };
}

const metrics = {} as MetricsService;

const alarms = (jwt: JwtAuthGuard, access: AccessControlService, registry: SocketRegistry) =>
  new AlarmsGateway(metrics, jwt, access, registry);

const telemetry = (jwt: JwtAuthGuard, access: AccessControlService, registry: SocketRegistry) =>
  new TelemetryGateway(
    { on: () => undefined } as unknown as TelemetryBroadcastHub,
    metrics,
    jwt,
    access,
    {} as ExistingAssetIds,
    registry,
  );

async function assertANotifyDuringScopeResolutionFindsTheSocket(
  build: typeof alarms | typeof telemetry,
): Promise<void> {
  const h = await startHandshake(build);
  expect(h.registry.disconnectUser(USER)).toBe(1);
  h.scope.resolve([]);
  await h.connecting;
}

export async function assertAlarmsHandshakeWindowIsClosed(): Promise<void> {
  await assertANotifyDuringScopeResolutionFindsTheSocket(alarms);
}

export async function assertTelemetryHandshakeWindowIsClosed(): Promise<void> {
  await assertANotifyDuringScopeResolutionFindsTheSocket(telemetry);
}

/** The re-read after the scope: a user disabled before the socket was registered is still closed. */
export async function assertADisabledReReadClosesTheSocket(): Promise<void> {
  const registry = new SocketRegistry();
  const jwt = { verifyToken: async () => PAYLOAD } as unknown as JwtAuthGuard;
  const access = {
    resolveUserId: () => USER,
    readableAssetIds: async () => [],
    isUserDisabled: async (id: string) => id === USER,
  } as unknown as AccessControlService;
  const gateway = alarms(jwt, access, registry);
  const client = Object.assign(fakeSocket(undefined), {
    data: {} as Record<string, unknown>,
    handshake: { auth: { token: "a-token" }, headers: {} },
  });
  await gateway.handleConnection(client as unknown as Socket);
  expect(client.closed).toBe(1);
}

/** Positive control for the re-read: an enabled user's socket stays open. */
export async function assertAnEnabledReReadKeepsTheSocket(): Promise<void> {
  const registry = new SocketRegistry();
  const jwt = { verifyToken: async () => PAYLOAD } as unknown as JwtAuthGuard;
  const access = {
    resolveUserId: () => USER,
    readableAssetIds: async () => [],
    isUserDisabled: async () => false,
  } as unknown as AccessControlService;
  const gateway = alarms(jwt, access, registry);
  const client = Object.assign(fakeSocket(undefined), {
    data: {} as Record<string, unknown>,
    handshake: { auth: { token: "a-token" }, headers: {} },
  });
  await gateway.handleConnection(client as unknown as Socket);
  expect(client.closed).toBe(0);
  expect(client.data.userId).toBe(USER);
}
