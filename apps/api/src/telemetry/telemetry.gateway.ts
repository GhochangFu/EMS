import { Logger } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { TelemetryReading } from "@bms/shared";
import { Namespace, Socket } from "socket.io";

import { AccessControlService } from "../auth/access-control.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MetricsService } from "../observability/metrics.service";
import { TelemetryBroadcastHub } from "./telemetry-broadcast.hub";

@WebSocketGateway({
  namespace: "/ws/telemetry",
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  },
})
export class TelemetryGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(TelemetryGateway.name);

  constructor(
    private readonly hub: TelemetryBroadcastHub,
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
    this.hub.on("readings", (readings: TelemetryReading[]) => {
      for (const client of this.server.sockets.values()) {
        const assetIds = client.data.assetIds as string[] | null | undefined;
        const visibleReadings =
          assetIds === null
            ? readings
            : readings.filter((reading) => assetIds?.includes(reading.assetId));
        if (visibleReadings.length > 0) {
          client.emit("telemetry", { readings: visibleReadings });
        }
      }
      this.metrics.countWebsocketEvent("/ws/telemetry", "telemetry");
      this.metrics.countTelemetryReadings(readings.length);
    });
    this.logger.log("WebSocket namespace /ws/telemetry ready");
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
