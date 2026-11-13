import { Inject, Logger, Optional } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { BmsDb } from "@bms/db";
import type { AlarmListItem } from "@bms/shared";
import { Namespace, Socket } from "socket.io";

import { AccessControlService } from "../auth/access-control.service";
import { JwtAuthGuard, serviceTokenOf } from "../auth/jwt-auth.guard";
import { SocketRegistry } from "../auth/socket-registry";
import { refuseRateLimitedHandshake } from "../rate-limit/handshake-limit";
import { RateLimiterService } from "../rate-limit/rate-limiter.service";
import { holdServiceTokenSocket, tagServiceTokenSocket } from "../service-accounts/service-token-socket";
import { ServiceTokenVerifier } from "../service-accounts/service-token-verifier.service";
import { MetricsService } from "../observability/metrics.service";
import { FLEET_DRIZZLE } from "../database/database.tokens";
import {
  alarmVisibleInMemory,
  EMPTY_DEVICE_ALARM_SCOPE,
  readAlarmOrganization,
  readDeviceAlarmScope,
  type DeviceAlarmScope,
} from "./alarm-scope";

type AlarmEventType = "created" | "acknowledged" | "cleared" | "suppression";

@WebSocketGateway({
  namespace: "/ws/alarms",
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  },
})
export class AlarmsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(AlarmsGateway.name);

  constructor(
    private readonly metrics: MetricsService,
    private readonly jwtAuth: JwtAuthGuard,
    private readonly accessControl: AccessControlService,
    private readonly sockets: SocketRegistry,
    // `F4.17` / ADR 0125 decision 2 — Stage 1 on the handshake. Optional so a
    // spec that builds the gateway by hand needs no limiter.
    @Optional() private readonly rateLimiter?: RateLimiterService,
    // F4.17 / ADR 0125: the post-registration liveness read. Absent, a token
    // socket is closed (fail closed), never kept.
    @Optional() private readonly serviceTokens?: ServiceTokenVerifier,
    // F3.16 / ADR 0127 decision 14: the socket's device scope and a host
    // alarm's organization. Fleet: a system fan-out with no single tenant (see
    // `readAlarmListItem`). Absent, a scoped socket receives no device alarm.
    @Optional() @Inject(FLEET_DRIZZLE) private readonly fleetDb?: BmsDb,
  ) {}

  /**
   * `F3.78` / ADR 0089 decision 8: `userId` is stored **immediately** after
   * `verifyToken`, before the scope `await`, so a `bms_user_disabled` NOTIFY
   * that lands during scope resolution finds this socket in the registry.
   * After the scope is stored, one fresh `disabled_at` read closes the socket
   * of a user deactivated before the socket could be found at all.
   */
  async handleConnection(client: Socket): Promise<void> {
    if (await refuseRateLimitedHandshake(this.rateLimiter, client)) {
      return;
    }
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      // F4.17 / ADR 0125 decision 13: tagged before the first await, so a
      // revoke that lands during verification still closes this socket.
      tagServiceTokenSocket(client, token);
      const payload = await this.jwtAuth.verifyToken(token);
      const userId = this.accessControl.resolveUserId(payload);
      client.data.userId = userId;
      const assetIds = await this.accessControl.readableAssetIds(payload);
      client.data.assetIds = assetIds;
      // F3.16: the device half of the scope, read once with the asset ids it
      // derives from — the RTUs serving them and the organizations where one is
      // on a monitored RTU. Cached for the socket's life, as `assetIds` is.
      client.data.deviceScope =
        assetIds === null
          ? null
          : this.fleetDb
            ? await readDeviceAlarmScope(this.fleetDb, assetIds)
            : EMPTY_DEVICE_ALARM_SCOPE;
      // A fresh liveness read once registered, and the expiry timer (PR 4 review M1, L2).
      if (!(await holdServiceTokenSocket(client, serviceTokenOf(payload), this.serviceTokens))) {
        return;
      }
      if (userId !== null && (await this.accessControl.isUserDisabled(userId))) {
        client.disconnect(true);
      }
    } catch {
      client.disconnect(true);
    }
  }

  afterInit(): void {
    this.sockets.register(this.server);
    this.logger.log("WebSocket namespace /ws/alarms ready");
  }

  /**
   * `F3.11` / ADR 0064 decision 4: the one caller is `AlarmNotifyService`,
   * fed by `LISTEN bms_alarms` (Unit 3) — not `AlarmRaiser`, which announces a
   * raise with a transactional `pg_notify` and holds no reference to this
   * gateway. That is what lets a raise on the worker, on `api` or on
   * `api-replica` reach the sockets of every API process: each one listens.
   */
  broadcastCreated(alarm: AlarmListItem): void {
    this.emitScoped(alarm, "created");
    this.metrics.countWebsocketEvent("/ws/alarms", "alarm");
    this.metrics.countAlarmEvent("created");
  }

  broadcastAcknowledged(alarm: AlarmListItem): void {
    this.emitScoped(alarm, "acknowledged");
    this.metrics.countWebsocketEvent("/ws/alarms", "alarm");
    this.metrics.countAlarmEvent("acknowledged");
  }

  /**
   * `F3.10` / ADR 0057 decision 1 (plan D7). The lifecycle sweep runs in this
   * process, so the alarm that just stopped being active can leave by the same
   * socket the raise arrived on; `alarms-page.tsx` invalidates on any `alarm`
   * event, so the rail drains without a reload.
   *
   * No unit case asserts this method: every spec that touches `AlarmsGateway`
   * stubs it with a no-op object cast `as unknown as AlarmsGateway`, so
   * nothing here is ever constructed with a fake namespace, and a stub cannot
   * prove the scoping. Since `F3.11` the only such stubs are the ones the
   * lifecycle and alarms-service suites hold; the raiser suites construct
   * `AlarmRaiser` without one, because the `created` broadcast now comes from
   * the `LISTEN bms_alarms` path (`AlarmNotifyService`, Unit 3) rather than
   * from the raise. `U7`'s `AlarmLifecycleService` spec asserts the call
   * through its deps fake, and the scoping itself is `emitScoped`'s, shared
   * with the two broadcasts above.
   */
  broadcastCleared(alarm: AlarmListItem): void {
    this.emitScoped(alarm, "cleared");
    this.metrics.countWebsocketEvent("/ws/alarms", "alarm");
    this.metrics.countAlarmEvent("cleared");
  }

  /**
   * `F4.359` plan D13: a maintenance-window stamp or lift. Nothing calls it
   * yet; the sweep does in a later unit. Same scoping as the others.
   */
  broadcastSuppression(alarm: AlarmListItem): void {
    this.emitScoped(alarm, "suppression");
    this.metrics.countWebsocketEvent("/ws/alarms", "alarm");
    this.metrics.countAlarmEvent("suppression");
  }

  /**
   * `F3.16` / ADR 0127 decision 14 through `alarmVisibleInMemory`, the
   * in-memory form of the list's scope rule. The list item does not carry its
   * organization, so an `ingest_host` alarm's is read first (one row by key);
   * every other alarm is delivered synchronously, as before.
   */
  private emitScoped(
    alarm: AlarmListItem,
    type: AlarmEventType,
  ): void {
    if (alarm.source !== "ingest_host") {
      this.deliver(alarm, type, null);
      return;
    }
    const read = this.fleetDb ? readAlarmOrganization(this.fleetDb, alarm.id) : Promise.resolve(null);
    void read
      .catch((err: unknown) => {
        this.logger.warn(`host alarm ${alarm.id}: organization unread (${String(err)}); scoped sockets skipped`);
        return null;
      })
      .then((organizationId) => this.deliver(alarm, type, organizationId));
  }

  private deliver(
    alarm: AlarmListItem,
    type: AlarmEventType,
    organizationId: string | null,
  ): void {
    for (const client of this.server.sockets.values()) {
      const assetIds = client.data.assetIds as string[] | null | undefined;
      if (assetIds === undefined) {
        continue; // not yet scoped: the handshake is still resolving
      }
      const device = (client.data.deviceScope as DeviceAlarmScope | null | undefined) ?? EMPTY_DEVICE_ALARM_SCOPE;
      if (alarmVisibleInMemory(alarm, organizationId, assetIds, device)) {
        client.emit("alarm", { type, alarm });
      }
    }
  }

  private extractToken(client: Socket): string | null {
    const raw = client.handshake.auth?.token;
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw;
    }
    const header = client.handshake.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length);
    }
    return null;
  }
}
