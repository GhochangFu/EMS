import { Logger, Optional } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { TelemetryReading } from "@bms/shared";
import { Namespace, Socket } from "socket.io";

import { AccessControlService } from "../auth/access-control.service";
import { JwtAuthGuard, serviceTokenOf } from "../auth/jwt-auth.guard";
import { SocketRegistry } from "../auth/socket-registry";
import { refuseRateLimitedHandshake } from "../rate-limit/handshake-limit";
import { RateLimiterService } from "../rate-limit/rate-limiter.service";
import { holdServiceTokenSocket, tagServiceTokenSocket } from "../service-accounts/service-token-socket";
import { ServiceTokenVerifier } from "../service-accounts/service-token-verifier.service";
import { MetricsService } from "../observability/metrics.service";
import { ExistingAssetIds } from "./existing-asset-ids";
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
    private readonly existingAssets: ExistingAssetIds,
    private readonly sockets: SocketRegistry,
    // `F4.17` / ADR 0125 decision 2 — Stage 1 on the handshake. Optional so a
    // spec that builds the gateway by hand needs no limiter.
    @Optional() private readonly rateLimiter?: RateLimiterService,
    // F4.17 / ADR 0125: the post-registration liveness read. Absent, a token
    // socket is closed (fail closed), never kept.
    @Optional() private readonly serviceTokens?: ServiceTokenVerifier,
  ) {}

  /**
   * `F3.78` / ADR 0089 decision 8 — the same handshake order as
   * `AlarmsGateway.handleConnection`: `userId` before the scope `await`, one
   * fresh `disabled_at` read after it.
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
      client.data.assetIds = await this.accessControl.readableAssetIds(payload);
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
    this.hub.on("readings", (readings: TelemetryReading[]) => {
      // F4.159: a reading whose asset row is gone reaches no socket
      // (`existing-asset-ids.ts`). Filtered once, before the per-client scope.
      const known = this.existingAssets.filter(readings);
      for (const client of this.server.sockets.values()) {
        const assetIds = client.data.assetIds as string[] | null | undefined;
        const visibleReadings =
          assetIds === null
            ? known
            : known.filter((reading) => assetIds?.includes(reading.assetId));
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
