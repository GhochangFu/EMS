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

  private emitScoped(alarm: AlarmListItem, type: "created" | "acknowledged"): void {
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
