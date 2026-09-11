import { Logger } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { AlarmListItem } from "@bms/shared";
import { Namespace, Socket } from "socket.io";

import { AccessControlService } from "../auth/access-control.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MetricsService } from "../observability/metrics.service";

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
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwtAuth.verifyToken(token);
      client.data.assetIds = await this.accessControl.readableAssetIds(payload);
    } catch {
      client.disconnect(true);
    }
  }

  afterInit(): void {
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

  private emitScoped(
    alarm: AlarmListItem,
    type: "created" | "acknowledged" | "cleared",
  ): void {
    for (const client of this.server.sockets.values()) {
      const assetIds = client.data.assetIds as string[] | null | undefined;
      if (assetIds === null || assetIds?.includes(alarm.assetId)) {
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
